---
description: Show the Jev compaction settings (provider, model, thresholds, key status)
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

Current settings of the claude-compact-openrouter plugin, as stored in the
user's settings.json:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/jev-config.mjs" show`

Show this output to the user verbatim in a code block. Do not read or print
any API key. If they want to change a value, tell them to run
`/jev-set <option> <value>` (for example `/jev-set provider typesafe`).
