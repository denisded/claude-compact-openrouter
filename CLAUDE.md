# CLAUDE.md

Плагин Claude Code (function hooks) + npm-библиотека: заменяет встроенное
саммари при компакции на решения модели Jev, которая по умолчанию вызывается
через OpenRouter (`POST https://openrouter.ai/api/alpha/decisions`,
модель `~typesafe/jev-latest`); опция `provider: typesafe` переключает на
оригинальный API TypeSafe (`api.typesafe.ai/v1/systemone`, `jev-latest`,
ключ `TYPESAFE_API_KEY`). Таблица провайдеров — `PROVIDERS` в `src/request.ts`.
Форк `tamaratran/fast-jev-compaction` (MIT); от оригинала отличается только
транспортом и именем — логику скоринга не трогать без причины.

Настройки плагина (`userConfig`) хранятся в `pluginConfigs` в
`~/.claude/settings.json`. Три команды: `/jev-settings` и `/jev-set <опция>
<значение>` — markdown-команды в `commands/`, запускают `scripts/jev-config.mjs`
(показ / запись settings.json); их Claude Desktop показывает на вкладке
«Commands». `/jev` — команда из function-hook-модуля: показывает то, что
движок реально загрузил; менять через `$.config.set` умеет только там, где
движок отдаёт строки `/config` плагина (в 2.1.278 их нет). Function-hook-модули
Desktop в инвентарь не включает, а редактора `userConfig` у него нет.

Подводные камни: в inline-bash markdown-команд работает `$ARGUMENTS`, а `$1`/`$2`
ломают команду молча; ненулевой код выхода inline-команды глотает вывод.
Валидатор (`claude plugin validate`): имя в `$.env.get(...)` — литерал; `$`
можно передавать только в функции верхнего уровня файла.

## Структура

- `src/` — библиотека: `state.ts` (сборка и ужатие state), `compact.ts`
  (вопросы, решения, пересборка сообщений), `request.ts` (HTTP-запрос к
  OpenRouter и разбор `answers`), `client.ts` (`JevClient` поверх `fetch`).
- `hooks/fast-jev.ts` — адаптер к Claude Code: `session.compact` и
  `turn.complete`. Работает в песочнике движка: сеть только через `$.http.fetch`,
  ключ — из опции `apiKey`/`typesafeApiKey`, `$.env.get` переменной провайдера
  или `env` в settings.
- `commands/*.md` + `scripts/jev-config.mjs` — команды `/jev-settings`,
  `/jev-set`; скрипт без зависимостей, тест — `tests/jev-config.test.ts`.
- `.claude-plugin/plugin.json` — манифест и `userConfig`; `marketplace.json` —
  маркетплейс из этого же репозитория.
- `types/claude-code.d.ts` — сгенерированные типы function hooks (Claude Code
  2.1.274). После обновления Claude Code перегенерировать через `/plugin-types`.
- `demo/JevDemo` — macOS-демо из оригинала, на Windows не собирается.

## Команды

```
npm install
npm test                 # vitest, без сети
npm run typecheck        # библиотека + хук
npm run validate:plugin  # claude plugin validate
npm run demo             # живой запрос к OpenRouter, нужен OPENROUTER_API_KEY
```

Через `rtk npm ...` на Windows не запускается (rtk не находит `npm.cmd`) —
вызывать npm напрямую из PowerShell.

Локальная проверка плагина: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .`

## Git

origin — `github.com/denisded/claude-compact-openrouter`, upstream —
`github.com/tamaratran/fast-jev-compaction`. README и код — на английском
(открытый проект), этот файл и коммуникация — на русском.
