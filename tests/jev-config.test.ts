import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(import.meta.dirname, '..', 'scripts', 'jev-config.mjs');

function run(configDir: string, ...args: string[]): { out: string; status: number } {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, OPENROUTER_API_KEY: '', TYPESAFE_API_KEY: '' },
    });
    return { out, status: 0 };
  } catch (error) {
    const failed = error as { stdout: string; status: number };
    return { out: failed.stdout, status: failed.status };
  }
}

describe('jev-config script', () => {
  it('shows defaults, writes pluginConfigs and reports key status from the env block', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jev-config-'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ env: { OPENROUTER_API_KEY: 'x' }, other: 1 }));

    const shown = run(dir, 'show');
    expect(shown.status).toBe(0);
    expect(shown.out).toContain('provider openrouter (https://openrouter.ai/api/alpha/decisions), model ~typesafe/jev-latest');
    expect(shown.out).toContain('OPENROUTER_API_KEY: set, TYPESAFE_API_KEY: unset');
    expect(shown.out).toMatch(/provider\s+openrouter\s+default\s+\[openrouter \| typesafe\]/);
    expect(shown.out).not.toContain('"x"');

    const set = run(dir, 'set', 'provider', 'typesafe');
    expect(set.status).toBe(0);
    expect(set.out).toContain('provider = typesafe');
    expect(set.out).toContain('provider typesafe (https://api.typesafe.ai/v1/systemone), model jev-latest');
    const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    expect(settings).toEqual({
      env: { OPENROUTER_API_KEY: 'x' },
      other: 1,
      pluginConfigs: { 'claude-compact-openrouter@claude-compact-openrouter': { options: { provider: 'typesafe' } } },
    });

    expect(run(dir, 'set', 'compactAtPercent', '70').out).toMatch(/compactAtPercent\s+70\s+settings/);
    expect(run(dir, 'set', 'compactAtPercent').out).toBe('compactAtPercent takes a number\n');
    expect(run(dir, 'set', 'provider', 'nope').out).toBe('provider takes one of: openrouter, typesafe\n');
    expect(run(dir, 'set', 'apiKey', 'k').out).toMatch(/^apiKey is sensitive/);
    expect(run(dir, 'set', 'nope', '1').out).toMatch(/^Unknown option "nope"\. Options: provider, keepThreshold, .*, model\n$/);

    run(dir, 'set', 'model', 'jev-1.13');
    expect(run(dir, 'set', 'model').out).toMatch(/^model cleared/);
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).pluginConfigs).toEqual({
      'claude-compact-openrouter@claude-compact-openrouter': { options: { provider: 'typesafe', compactAtPercent: 70 } },
    });
  });
});
