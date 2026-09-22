import type {
  ConfigRow,
  On,
  PluginOptions,
  Register,
  SessionMessage,
  ToolResultSummary,
  ToolUseSummary,
  TurnCompleteInput,
} from 'claude-code';

import { compact, reductionRatio, resolveOptions } from '../src/compact.js';
import {
  buildJevRequest,
  DEFAULT_PROVIDER,
  isJevProvider,
  parseJevResponse,
  PROVIDERS,
  type JevProvider,
} from '../src/request.js';
import type {
  CompactOptions,
  CompactResult,
  JevAsker,
  Message,
  ToolResult,
  ToolUse,
} from '../src/types.js';

const HOOK_DEFAULTS = {
  compactAtPercent: 60,
  minReductionRatio: 0.25,
};

/** The manifest's name: `/config` rows for the plugin's `userConfig` are keyed `<name>.<field>`. */
export const PLUGIN_NAME = 'claude-compact-openrouter';
export const COMMAND_NAME = 'jev';

function rowField(row: ConfigRow): string | undefined {
  return row.key.startsWith(`${PLUGIN_NAME}.`) ? row.key.slice(PLUGIN_NAME.length + 1) : undefined;
}

/** Load-time options overlaid with the live `/config` rows, so a change applies without a reload. */
export function liveOptions(options: PluginOptions, rows: readonly ConfigRow[]): PluginOptions {
  const live: Record<string, PluginOptions[string]> = { ...options };
  for (const row of rows) {
    const field = rowField(row);
    if (field) live[field] = row.value;
  }
  return live;
}

export type SetArgs = { key: string; value: ConfigRow['value'] } | { error: string };

/** Turns `/jev <option> <value>` into a `$.config.set` call, held to the row's kind. */
export function parseSetArgs(args: string, rows: readonly ConfigRow[]): SetArgs {
  const [field = '', ...rest] = args.trim().split(/\s+/);
  const raw = rest.join(' ');
  const row = rows.find((r) => rowField(r) === field);
  if (!row) {
    const fields = rows.map(rowField).filter(Boolean).join(', ');
    return { error: `Unknown option "${field}". Options: ${fields}` };
  }
  switch (row.kind) {
    case 'number': {
      const value = Number(raw);
      if (raw === '' || !Number.isFinite(value)) return { error: `${field} takes a number` };
      return { key: row.key, value };
    }
    case 'boolean':
      if (raw !== 'true' && raw !== 'false') return { error: `${field} takes true or false` };
      return { key: row.key, value: raw === 'true' };
    case 'choice':
      if (!row.options?.includes(raw)) {
        return { error: `${field} takes one of: ${row.options?.join(', ') ?? ''}` };
      }
      return { key: row.key, value: raw };
    default:
      return { key: row.key, value: raw };
  }
}

/** The manifest's non-sensitive fields, in display order, for when `/config` lists no plugin rows. */
const OPTION_FIELDS = [
  'provider',
  'model',
  'keepThreshold',
  'preserveRecentMessages',
  'compactAtPercent',
  'minReductionRatio',
  'maxStateTokens',
  'maxRequestTokens',
  'truncateHeadChars',
] as const;

export type OptionEntry = { field: string; value: unknown; choices?: readonly string[]; locked?: boolean };

/** What `/jev` lists: the plugin's `/config` rows, or the loaded options when the host lists none. */
export function optionEntries(options: PluginOptions, rows: readonly ConfigRow[]): OptionEntry[] {
  const fromRows: OptionEntry[] = [];
  for (const row of rows) {
    const field = rowField(row);
    if (!field) continue;
    const entry: OptionEntry = { field, value: row.value };
    if (row.options) entry.choices = row.options;
    if (row.isLocked) entry.locked = true;
    fromRows.push(entry);
  }
  if (fromRows.length > 0) return fromRows;
  return OPTION_FIELDS.map((field) => ({ field, value: options[field] ?? '' }));
}

/** The `/jev` output: the resolved setup, every option and how to change one. */
export function formatConfigReport(
  config: HookConfig,
  entries: readonly OptionEntry[],
  keys: Record<JevProvider, boolean>,
  canSet: boolean,
): string {
  const provider = PROVIDERS[config.provider];
  const lines = [
    `${PLUGIN_NAME}: provider ${config.provider} (${provider.url}), model ${config.model}`,
    (Object.keys(PROVIDERS) as JevProvider[])
      .map((p) => `${PROVIDERS[p].envKey}: ${keys[p] ? 'set' : 'unset'}`)
      .join(', '),
    '',
  ];
  const width = Math.max(...entries.map((e) => e.field.length), 0);
  for (const entry of entries) {
    const choices = entry.choices ? `  [${entry.choices.join(' | ')}]` : '';
    const lock = entry.locked ? '  (locked)' : '';
    lines.push(`  ${entry.field.padEnd(width)}  ${String(entry.value)}${choices}${lock}`);
  }
  lines.push(
    '',
    canSet
      ? `Change one with /${COMMAND_NAME} <option> <value>, e.g. /${COMMAND_NAME} provider typesafe`
      : `Change one with /jev-set <option> <value> (e.g. /jev-set provider typesafe), in /plugin → ${PLUGIN_NAME} → Configure options, or under pluginConfigs in ~/.claude/settings.json; all apply without a restart.`,
  );
  return lines.join('\n');
}

export type HookFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

export type HookFetchResponse = {
  status: number;
  ok: boolean;
  text: string;
};

/** The shape of `$.http.fetch`, so the hook can be driven without an engine. */
export type HookFetch = (url: string, init?: HookFetchInit) => Promise<HookFetchResponse>;

export type HookConfig = CompactOptions & {
  provider: JevProvider;
  apiKey?: string;
  compactAtPercent: number;
  minReductionRatio: number;
  model: string;
};

function optionNumber(options: PluginOptions, key: string, fallback: number): number {
  const value = options[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionString(options: PluginOptions, key: string): string | undefined {
  const value = options[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Reads the plugin's `userConfig` values; anything missing takes the defaults. */
export function resolveHookConfig(options: PluginOptions): HookConfig {
  const numbers: Partial<Omit<CompactOptions, 'goal'>> = {};
  for (const key of [
    'keepThreshold',
    'preserveRecentMessages',
    'maxStateTokens',
    'maxRequestTokens',
    'truncateHeadChars',
  ] as const) {
    const value = options[key];
    if (typeof value === 'number' && Number.isFinite(value)) numbers[key] = value;
  }
  const provider = isJevProvider(options['provider']) ? options['provider'] : DEFAULT_PROVIDER;
  const config: HookConfig = {
    ...numbers,
    provider,
    compactAtPercent: optionNumber(options, 'compactAtPercent', HOOK_DEFAULTS.compactAtPercent),
    minReductionRatio: optionNumber(
      options,
      'minReductionRatio',
      HOOK_DEFAULTS.minReductionRatio,
    ),
    model: optionString(options, 'model') ?? PROVIDERS[provider].model,
  };
  const apiKey = optionString(options, provider === 'typesafe' ? 'typesafeApiKey' : 'apiKey');
  if (apiKey) config.apiKey = apiKey;
  const goal = optionString(options, 'goal');
  if (goal) config.goal = goal;
  return config;
}

/** A `JevAsker` over the engine's `$.http.fetch`. */
export function jevAsker(
  fetchFn: HookFetch,
  apiKey: string,
  model: string,
  provider: JevProvider = DEFAULT_PROVIDER,
): JevAsker {
  return {
    async ask(state, questions) {
      const request = buildJevRequest({ apiKey, model, provider }, state, questions);
      const response = await fetchFn(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
      return parseJevResponse(response.status, response.ok, response.text);
    },
  };
}

function toolUseSummary(tool: ToolUse): ToolUseSummary {
  const summary: ToolUseSummary = {
    tool_use_id: tool.tool_use_id,
    tool: tool.tool,
    input: tool.input,
  };
  if (tool.text !== undefined) summary.text = tool.text;
  if (tool.isError) summary.isError = true;
  return summary;
}

function toolResultSummary(result: ToolResult): ToolResultSummary {
  return {
    tool_use_id: result.tool_use_id,
    text: result.text,
    isError: result.isError ?? false,
  };
}

/**
 * Maps the library's output back onto session messages. Whatever came back
 * unchanged (a message, a tool use, a tool result) is the engine's own object,
 * handle included; anything rebuilt is a fresh message without a handle, so the
 * engine takes the edited content instead of its original.
 */
export function toSessionMessages(
  input: readonly SessionMessage[],
  output: readonly Message[],
): SessionMessage[] {
  const messages = new Map<Message, SessionMessage>();
  const uses = new Map<ToolUse, ToolUseSummary>();
  const results = new Map<ToolResult, ToolResultSummary>();
  for (const message of input) {
    messages.set(message, message);
    for (const tool of message.toolUses) uses.set(tool, tool);
    for (const result of message.toolResults ?? []) results.set(result, result);
  }
  return output.map((message) => {
    const own = messages.get(message);
    if (own) return own;
    const rebuilt: SessionMessage = {
      role: message.role,
      text: message.text,
      toolUses: message.toolUses.map((tool) => uses.get(tool) ?? toolUseSummary(tool)),
    };
    if (message.toolResults && message.toolResults.length > 0) {
      rebuilt.toolResults = message.toolResults.map(
        (result) => results.get(result) ?? toolResultSummary(result),
      );
    }
    return rebuilt;
  });
}

export type SessionCompaction = {
  result: CompactResult;
  messages: SessionMessage[];
};

/** Runs the library over a session transcript; throws when the key is missing or Jev fails. */
export async function compactSession(
  messages: readonly SessionMessage[],
  config: HookConfig,
  fetchFn: HookFetch,
): Promise<SessionCompaction> {
  if (!config.apiKey) throw new Error(`${PROVIDERS[config.provider].envKey} is not configured`);
  const result = await compact(
    messages,
    jevAsker(fetchFn, config.apiKey, config.model, config.provider),
    config,
  );
  return { result, messages: toSessionMessages(messages, result.messages) };
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function summarize(result: CompactResult): string {
  const { stats } = result;
  const parts = [
    stats.kept > 0 ? `${stats.kept} kept` : '',
    stats.resultsDropped > 0 ? `${stats.resultsDropped} results truncated` : '',
    stats.callsDropped > 0 ? `${stats.callsDropped} call_dropped` : '',
    stats.pinned > 0 ? `${stats.pinned} pinned` : '',
  ].filter(Boolean);
  return `${percent(reductionRatio(result))} reduction; ${
    parts.join(', ') || 'no tool calls'
  }; state ~${stats.stateTokens} tokens (${stats.stateStage}) in ${stats.requests} request(s)`;
}

const UI_LOG_MAX_CHARS = 4096;

export function decisionLog(result: CompactResult): string {
  return result.decisions
    .filter((d) => d.reason !== 'pinned')
    .map(
      (d) =>
        `${d.id}:${d.tool}:${d.action}/call=${d.keepCall.toFixed(2)}/result=${d.keepResult.toFixed(2)}`,
    )
    .join(' ');
}

export function decisionLogLines(
  result: CompactResult,
  maxChars: number = UI_LOG_MAX_CHARS,
): string[] {
  const entries = decisionLog(result).split(' ').filter(Boolean);
  if (entries.length === 0) return ['decisions: (none)'];
  const chunks: string[] = [];
  let current = '';
  for (const entry of entries) {
    const next = current ? `${current} ${entry}` : entry;
    if (current && next.length > maxChars - 24) {
      chunks.push(current);
      current = entry;
    } else current = next;
  }
  chunks.push(current);
  return chunks.map((chunk, index) =>
    chunks.length === 1
      ? `decisions: ${chunk}`
      : `decisions (${index + 1}/${chunks.length}): ${chunk}`,
  );
}

async function getApiKey(
  $: {
    env: { get: (name: string) => Promise<string | undefined> };
    settings: { read: () => Promise<Readonly<Record<string, unknown>>> };
  },
  config: HookConfig,
): Promise<string | undefined> {
  if (config.apiKey) return config.apiKey;
  // `$.env.get` needs a literal name so the host can list what the module reads.
  const fromEnv =
    config.provider === 'typesafe'
      ? await $.env.get('TYPESAFE_API_KEY')
      : await $.env.get('OPENROUTER_API_KEY');
  if (fromEnv) return fromEnv;
  const { envKey } = PROVIDERS[config.provider];
  const settings = await $.settings.read();
  const env = settings['env'];
  if (env && typeof env === 'object') {
    const value = (env as Record<string, unknown>)[envKey];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function notify(
  $: {
    ui: {
      log: (text: string) => void;
      toast: (text: string, options?: { timeoutMs?: number }) => void;
    };
  },
  text: string,
): void {
  $.ui.log(text);
  $.ui.toast(text, { timeoutMs: 15_000 });
}

/** Whether a key is reachable for each provider, without revealing any. */
async function keyStatus(
  $: Parameters<typeof getApiKey>[0],
  options: PluginOptions,
  rows: readonly ConfigRow[],
): Promise<Record<JevProvider, boolean>> {
  const keys: Record<JevProvider, boolean> = { openrouter: false, typesafe: false };
  for (const provider of Object.keys(keys) as JevProvider[]) {
    const probe = resolveHookConfig({ ...liveOptions(options, rows), provider });
    keys[provider] = Boolean(await getApiKey($, probe));
  }
  return keys;
}

// Re-read the `/config` rows on every use so `/jev` and `/config` changes apply at once.
async function currentConfig(
  $: { config: { list: () => Promise<ConfigRow[]> } },
  options: PluginOptions,
): Promise<{ rows: ConfigRow[]; config: HookConfig }> {
  const rows = await $.config.list();
  return { rows, config: resolveHookConfig(liveOptions(options, rows)) };
}

export const register: Register = (on: On, options: PluginOptions) => {
  let compacting = false;

  on('session.start', async ($, event, next) => {
    await $.command.register({
      name: COMMAND_NAME,
      description: 'Show or change the Jev compaction settings (provider, model, thresholds).',
      argumentHint: '[option value]',
    });
    return next(event);
  });

  on('command.run', { command: COMMAND_NAME }, async ($, event) => {
    let { rows, config } = await currentConfig($, options);
    const canSet = rows.some((row) => rowField(row) !== undefined);
    if (event.args.trim()) {
      if (!canSet) {
        return {
          text: `This Claude Code lists no /config rows for the plugin, so /${COMMAND_NAME} cannot change options here. ${formatConfigReport(config, optionEntries(options, rows), await keyStatus($, options, rows), false).split('\n').at(-1)}`,
        };
      }
      const parsed = parseSetArgs(event.args, rows);
      if ('error' in parsed) return { text: parsed.error };
      const outcome = await $.config.set({ key: parsed.key, value: parsed.value });
      if ('deny' in outcome && outcome.deny) return { text: `${parsed.key}: ${outcome.deny}` };
      ({ rows, config } = await currentConfig($, options));
    }
    const keys = await keyStatus($, options, rows);
    return { text: formatConfigReport(config, optionEntries(options, rows), keys, canSet) };
  });

  on('session.compact', async ($, event, next) => {
    try {
      const { config: configured } = await currentConfig($, options);
      const config = { ...configured, apiKey: await getApiKey($, configured) };
      const { result, messages } = await compactSession(event.messages, config, async (url, init) => {
        const response = await $.http.fetch(url, init);
        return { status: response.status, ok: response.ok, text: response.text };
      });
      for (const line of decisionLogLines(result)) $.ui.log(line);
      if (reductionRatio(result) < config.minReductionRatio) {
        notify(
          $,
          `fallback to built-in summary (below ${percent(config.minReductionRatio)} minimum: ${summarize(result)})`,
        );
        return next(event);
      }
      notify(
        $,
        `kept ${messages.length}/${event.messages.length} messages, no summary (${summarize(result)})`,
      );
      return { messages };
    } catch (error) {
      notify(
        $,
        `fallback to built-in summary (${error instanceof Error ? error.message : String(error)})`,
      );
      return next(event);
    }
  });

  on('turn.complete', async ($, event: TurnCompleteInput, next) => {
    if (compacting) return next(event);
    try {
      const { context } = await $.session.usage();
      const { config } = await currentConfig($, options);
      if ((context.percent ?? 0) < config.compactAtPercent) return next(event);
      compacting = true;
      await $.session.compact();
    } catch (error) {
      $.ui.log(
        `auto-compact skipped (${error instanceof Error ? error.message : String(error)})`,
      );
    } finally {
      compacting = false;
    }
    return next(event);
  });
};

export { resolveOptions };
