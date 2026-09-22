#!/usr/bin/env node
// Shows or changes the plugin's userConfig values stored under `pluginConfigs`
// in the user's settings.json. Backs the /jev-settings and /jev-set commands,
// which Claude Desktop lists on the plugin page; /jev (the function hook) shows
// the same values from inside the engine but cannot write settings.
//
//   node jev-config.mjs show
//   node jev-config.mjs set <option> [value]     (no value clears a text option)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_NAME = 'claude-compact-openrouter';
const DEFAULT_PLUGIN_ID = `${PLUGIN_NAME}@${PLUGIN_NAME}`;
const PROVIDERS = {
  openrouter: {
    url: 'https://openrouter.ai/api/alpha/decisions',
    model: '~typesafe/jev-latest',
    envKey: 'OPENROUTER_API_KEY',
  },
  typesafe: {
    url: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
    envKey: 'TYPESAFE_API_KEY',
  },
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const settingsPath = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'settings.json');
const schema = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).userConfig;

function readSettings() {
  return existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
}

function pluginId(settings) {
  const ids = Object.keys(settings.pluginConfigs ?? {});
  return ids.find((id) => id.startsWith(`${PLUGIN_NAME}@`)) ?? DEFAULT_PLUGIN_ID;
}

function storedOptions(settings) {
  return settings.pluginConfigs?.[pluginId(settings)]?.options ?? {};
}

function hasKey(settings, envKey) {
  return Boolean(process.env[envKey] || settings.env?.[envKey]);
}

function show(settings) {
  const stored = storedOptions(settings);
  const provider = PROVIDERS[stored.provider] ? stored.provider : 'openrouter';
  const model = typeof stored.model === 'string' && stored.model ? stored.model : PROVIDERS[provider].model;
  const lines = [
    `${PLUGIN_NAME}: provider ${provider} (${PROVIDERS[provider].url}), model ${model}`,
    Object.values(PROVIDERS)
      .map((p) => `${p.envKey}: ${hasKey(settings, p.envKey) ? 'set' : 'unset'}`)
      .join(', '),
    '',
  ];
  const fields = Object.keys(schema).filter((f) => !schema[f].sensitive);
  const width = Math.max(...fields.map((f) => f.length));
  for (const field of fields) {
    const value = stored[field] ?? schema[field].default ?? '';
    const source = field in stored ? 'settings' : 'default';
    const choices = schema[field].options ? `  [${schema[field].options.join(' | ')}]` : '';
    lines.push(`  ${field.padEnd(width)}  ${String(value).padEnd(22)} ${source}${choices}`);
  }
  lines.push(
    '',
    `Stored under pluginConfigs["${pluginId(settings)}"].options in ${settingsPath}.`,
    'Change one with /jev-set <option> <value>, e.g. /jev-set provider typesafe. API keys come from the env block of settings.json.',
  );
  return lines.join('\n');
}

function coerce(field, raw) {
  const spec = schema[field];
  if (!spec) throw new Error(`Unknown option "${field}". Options: ${Object.keys(schema).filter((f) => !schema[f].sensitive).join(', ')}`);
  if (spec.sensitive) throw new Error(`${field} is sensitive; put the key in the env block of ${settingsPath} instead.`);
  if (spec.type === 'number') {
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value)) throw new Error(`${field} takes a number`);
    return value;
  }
  if (spec.type === 'boolean') {
    if (raw !== 'true' && raw !== 'false') throw new Error(`${field} takes true or false`);
    return raw === 'true';
  }
  if (spec.options && !spec.options.includes(raw)) throw new Error(`${field} takes one of: ${spec.options.join(', ')}`);
  return raw;
}

function set(settings, field, raw) {
  const value = coerce(field, raw);
  const id = pluginId(settings);
  settings.pluginConfigs ??= {};
  settings.pluginConfigs[id] ??= {};
  settings.pluginConfigs[id].options ??= {};
  if (value === '') delete settings.pluginConfigs[id].options[field];
  else settings.pluginConfigs[id].options[field] = value;
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return `${field} ${value === '' ? 'cleared' : `= ${String(value)}`} (${settingsPath}); Claude Code picks it up without a restart.\n\n${show(settings)}`;
}

const [action = 'show', field = '', ...rest] = process.argv.slice(2);
try {
  const settings = readSettings();
  if (action === 'show') console.log(show(settings));
  else if (action === 'set' && field) console.log(set(settings, field, rest.join(' ')));
  else throw new Error('Usage: jev-config.mjs show | set <option> [value]');
} catch (error) {
  // Exit 0 on purpose: a failing inline command would drop the output from the slash command.
  console.log(error instanceof Error ? error.message : String(error));
}
