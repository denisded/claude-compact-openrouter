---
description: Change one Jev compaction option, e.g. provider typesafe
argument-hint: [option] [value]
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

The user asked to set the claude-compact-openrouter option `$ARGUMENTS`. The
plugin's script has applied it to settings.json and printed the result:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/jev-config.mjs" set $ARGUMENTS`

Show this output to the user verbatim in a code block. If it reports an
error (unknown option, wrong value type, sensitive field), explain it in one
sentence and list the valid options from the output. Do not read, print or
edit any API key; keys belong in the env block of settings.json.
