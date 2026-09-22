import type { ConfigRow } from 'claude-code';
import { describe, expect, it } from 'vitest';
import {
  compactSession,
  decisionLog,
  decisionLogLines,
  formatConfigReport,
  liveOptions,
  optionEntries,
  parseSetArgs,
  resolveHookConfig,
  summarize,
  toSessionMessages,
} from '../hooks/fast-jev.ts';
import { applyDecisions, collectToolCalls, decideCall, type Message } from '../src/index.js';

type SessionMessage = Message & { handle?: string };

function message(role: Message['role'], text: string, extra: Partial<SessionMessage> = {}): SessionMessage {
  return { role, text, toolUses: [], ...extra };
}

function call(id: string, tool: string, input: Record<string, unknown>, text: string): SessionMessage {
  return message('assistant', '', {
    toolUses: [{ tool_use_id: id, tool, input, text }],
    handle: `h-${id}`,
  });
}

function result(id: string, text: string, isError = false): SessionMessage {
  return message('user', '', { toolResults: [{ tool_use_id: id, text, isError }], handle: `r-${id}` });
}

const fileA = 'export const a = 1;\n'.repeat(50);

function transcript(): SessionMessage[] {
  return [
    message('user', 'Fix the failing test.', { handle: 'h-0' }),
    call('tool-1', 'Read', { file_path: 'src/a.ts' }, fileA),
    result('tool-1', fileA),
    call('tool-2', 'Bash', { command: 'npm test' }, 'FAIL'),
    result('tool-2', 'FAIL b.test.ts: expected 2 to be 3', true),
    message('assistant', 'Fixing now.', { handle: 'h-5' }),
    message('user', 'go ahead', { handle: 'h-6' }),
  ];
}

function jevFetch(answer: (name: string) => number, bodies: string[] = []) {
  return async (_url: string, init?: { body?: string }) => {
    bodies.push(init?.body ?? '');
    const { questions } = JSON.parse(init?.body ?? '{}') as { questions: Record<string, unknown> };
    const answers = Object.fromEntries(
      Object.keys(questions).map((key) => [key, { type: 'noul', noul: answer(key) }]),
    );
    return { status: 200, ok: true, text: JSON.stringify({ answers }) };
  };
}

describe('hook config', () => {
  it('reads userConfig values and falls back to defaults', () => {
    expect(resolveHookConfig({})).toEqual({
      provider: 'openrouter',
      compactAtPercent: 60,
      minReductionRatio: 0.25,
      model: '~typesafe/jev-latest',
    });
    expect(
      resolveHookConfig({ apiKey: 'k', keepThreshold: 0.3, maxStateTokens: 1000, model: 'jev-x', goal: 'g', compactAtPercent: 'no' }),
    ).toEqual({
      provider: 'openrouter',
      apiKey: 'k',
      keepThreshold: 0.3,
      maxStateTokens: 1000,
      model: 'jev-x',
      goal: 'g',
      compactAtPercent: 60,
      minReductionRatio: 0.25,
    });
  });

  it('switches the key and the default model with the provider', () => {
    expect(resolveHookConfig({ provider: 'typesafe', apiKey: 'or', typesafeApiKey: 'ts' })).toEqual({
      provider: 'typesafe',
      apiKey: 'ts',
      compactAtPercent: 60,
      minReductionRatio: 0.25,
      model: 'jev-latest',
    });
    expect(resolveHookConfig({ provider: 'nope' }).provider).toBe('openrouter');
  });
});

function row(field: string, kind: ConfigRow['kind'], value: ConfigRow['value'], options?: string[]): ConfigRow {
  return {
    key: `claude-compact-openrouter.${field}`,
    label: field,
    kind,
    value,
    ...(options ? { options } : {}),
    provider: { kind: 'plugin', name: 'claude-compact-openrouter' },
    isLocked: false,
  };
}

const rows = [
  row('provider', 'choice', 'openrouter', ['openrouter', 'typesafe']),
  row('compactAtPercent', 'number', 60),
  row('model', 'text', ''),
  { ...row('theme', 'text', 'dark'), key: 'theme', provider: { kind: 'engine', tier: 'core' } } as ConfigRow,
];

describe('/jev command', () => {
  it('overlays live /config rows on the load-time options', () => {
    const live = liveOptions({ provider: 'openrouter', compactAtPercent: 60, apiKey: 'k' }, [
      row('provider', 'choice', 'typesafe'),
      row('compactAtPercent', 'number', 70),
    ]);
    expect(live).toEqual({ provider: 'typesafe', compactAtPercent: 70, apiKey: 'k' });
    expect(resolveHookConfig(live).model).toBe('jev-latest');
  });

  it('parses a set call held to the row kind', () => {
    expect(parseSetArgs('provider typesafe', rows)).toEqual({ key: 'claude-compact-openrouter.provider', value: 'typesafe' });
    expect(parseSetArgs('provider nope', rows)).toEqual({ error: 'provider takes one of: openrouter, typesafe' });
    expect(parseSetArgs('compactAtPercent 75', rows)).toEqual({ key: 'claude-compact-openrouter.compactAtPercent', value: 75 });
    expect(parseSetArgs('compactAtPercent x', rows)).toEqual({ error: 'compactAtPercent takes a number' });
    expect(parseSetArgs('model', rows)).toEqual({ key: 'claude-compact-openrouter.model', value: '' });
    expect(parseSetArgs('theme dark', rows)).toEqual({
      error: 'Unknown option "theme". Options: provider, compactAtPercent, model',
    });
  });

  it('reports the resolved setup and every plugin row', () => {
    const entries = optionEntries({}, rows);
    expect(entries.map((e) => e.field)).toEqual(['provider', 'compactAtPercent', 'model']);
    const text = formatConfigReport(resolveHookConfig({}), entries, { openrouter: true, typesafe: false }, true);
    expect(text.split('\n')).toEqual([
      'claude-compact-openrouter: provider openrouter (https://openrouter.ai/api/alpha/decisions), model ~typesafe/jev-latest',
      'OPENROUTER_API_KEY: set, TYPESAFE_API_KEY: unset',
      '',
      '  provider          openrouter  [openrouter | typesafe]',
      '  compactAtPercent  60',
      '  model             ',
      '',
      'Change one with /jev <option> <value>, e.g. /jev provider typesafe',
    ]);
  });

  it('falls back to the loaded options when the host lists no plugin rows', () => {
    const options = { provider: 'typesafe', compactAtPercent: 70, apiKey: 'secret' };
    const entries = optionEntries(options, [rows[3]!]);
    expect(entries.map((e) => `${e.field}=${String(e.value)}`)).toEqual([
      'provider=typesafe',
      'model=',
      'keepThreshold=',
      'preserveRecentMessages=',
      'compactAtPercent=70',
      'minReductionRatio=',
      'maxStateTokens=',
      'maxRequestTokens=',
      'truncateHeadChars=',
    ]);
    const text = formatConfigReport(resolveHookConfig(options), entries, { openrouter: false, typesafe: true }, false);
    expect(text).not.toContain('secret');
    expect(text.split('\n').at(-1)).toMatch(/^Change them in \/plugin/);
  });
});

describe('session message mapping', () => {
  it('returns the engine objects for untouched messages and handle-less copies for rebuilt ones', () => {
    const messages = transcript();
    const calls = collectToolCalls(messages, 0);
    const decisions = [
      decideCall(calls[0]!, { keepCall: 0.9, keepResult: 0.1 }, { keepThreshold: 0.5 }),
      decideCall(calls[1]!, { keepCall: 0.9, keepResult: 0.9 }, { keepThreshold: 0.5 }),
    ];
    messages[1]!.toolUses[0]!.text = 'x'.repeat(2000);
    messages[2]!.toolResults![0]!.text = 'x'.repeat(2000);
    const out = toSessionMessages(messages, applyDecisions(messages, decisions, calls, 300));
    expect(out).toHaveLength(messages.length);
    expect(out[0]).toBe(messages[0]);
    expect(out[1]?.handle).toBeUndefined();
    expect(out[1]?.toolUses[0]?.text).toMatch(
      new RegExp(`^${'x'.repeat(300)}\\n\\[claude-compact-openrouter truncated 1700 chars`),
    );
    expect(out[2]?.handle).toBeUndefined();
    expect(out[2]?.toolResults?.[0]?.text).toMatch(
      new RegExp(`^${'x'.repeat(300)}\\n\\[claude-compact-openrouter truncated 1700 chars`),
    );
    expect(out[2]?.toolResults?.[0]).toMatchObject({ tool_use_id: 'tool-1', isError: false });
    expect(out[3]).toBe(messages[3]);
    expect(out[4]).toBe(messages[4]);
  });

  it('preserves short dropped-result messages and their handles', () => {
    const messages = transcript();
    messages[1]!.toolUses[0]!.text = 'y'.repeat(100);
    messages[2]!.toolResults![0]!.text = 'y'.repeat(100);
    const calls = collectToolCalls(messages, 0);
    const decisions = [
      decideCall(calls[0]!, { keepCall: 0.9, keepResult: 0.1 }, { keepThreshold: 0.5 }),
      decideCall(calls[1]!, { keepCall: 0.9, keepResult: 0.9 }, { keepThreshold: 0.5 }),
    ];
    const out = toSessionMessages(messages, applyDecisions(messages, decisions, calls, 300));
    expect(out[1]).toBe(messages[1]);
    expect(out[2]).toBe(messages[2]);
  });
});

describe('compactSession', () => {
  it('runs the library over the engine fetch and reports the outcome', async () => {
    const bodies: string[] = [];
    const config = { ...resolveHookConfig({ preserveRecentMessages: 1 }), apiKey: 'k', model: 'jev-x' };
    const { result: output, messages } = await compactSession(
      transcript(),
      config,
      jevFetch((name) => (name === 'call_t2' || name === 'result_t2' ? 0.9 : 0.1), bodies),
    );
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0]!).model).toBe('jev-x');
    expect(output.decisions.map((d) => d.action)).toEqual(['drop_call', 'keep']);
    expect(messages.map((m) => m.handle)).toEqual(['h-0', 'h-tool-2', 'r-tool-2', 'h-5', 'h-6']);
    expect(summarize(output)).toMatch(/^\d+% reduction; 1 kept, 1 call_dropped; state ~\d+ tokens \(full\) in 1 request\(s\)$/);
    expect(decisionLog(output)).toBe('t1:Read:drop_call/call=0.10/result=0.10 t2:Bash:keep/call=0.90/result=0.90');
    expect(decisionLogLines(output)).toEqual([`decisions: ${decisionLog(output)}`]);
  });

  it('splits a long decision log into ui.log lines under the host limit', async () => {
    const config = { ...resolveHookConfig({ preserveRecentMessages: 1 }), apiKey: 'k' };
    const { result: output } = await compactSession(transcript(), config, jevFetch(() => 0.1));
    const lines = decisionLogLines(output, 60);
    expect(lines).toEqual([
      'decisions (1/2): t1:Read:drop_call/call=0.10/result=0.10',
      'decisions (2/2): t2:Bash:drop_call/call=0.10/result=0.10',
    ]);
    expect(lines.every((line) => line.length <= 60)).toBe(true);
    expect(decisionLogLines({ ...output, decisions: [] })).toEqual(['decisions: (none)']);
  });

  it('throws on a missing key and on failed requests so the hook falls back', async () => {
    const config = resolveHookConfig({ preserveRecentMessages: 1 });
    await expect(compactSession(transcript(), config, jevFetch(() => 0))).rejects.toThrow(/OPENROUTER_API_KEY/);
    await expect(
      compactSession(transcript(), { ...config, provider: 'typesafe' }, jevFetch(() => 0)),
    ).rejects.toThrow(/TYPESAFE_API_KEY/);
    await expect(
      compactSession(transcript(), { ...config, apiKey: 'k' }, async () => ({ status: 500, ok: false, text: 'x' })),
    ).rejects.toThrow(/500/);
  });
});
