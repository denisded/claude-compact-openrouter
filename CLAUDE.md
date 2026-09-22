# CLAUDE.md

Плагин Claude Code (function hooks) + npm-библиотека: заменяет встроенное
саммари при компакции на решения модели Jev, которая по умолчанию вызывается
через OpenRouter (`POST https://openrouter.ai/api/alpha/decisions`,
модель `~typesafe/jev-latest`); опция `provider: typesafe` переключает на
оригинальный API TypeSafe (`api.typesafe.ai/v1/systemone`, `jev-latest`,
ключ `TYPESAFE_API_KEY`). Таблица провайдеров — `PROVIDERS` в `src/request.ts`.
Форк `tamaratran/fast-jev-compaction` (MIT); от оригинала отличается только
транспортом и именем — логику скоринга не трогать без причины.

Настройки плагина (`userConfig`) редактируются в `/config` интерактивного
`claude` или в `pluginConfigs` в `~/.claude/settings.json`; Claude Desktop их
только перечисляет, редактора там нет. Имя переменной в `$.env.get(...)` должно
быть литералом — иначе `claude plugin validate` отклонит модуль.

## Структура

- `src/` — библиотека: `state.ts` (сборка и ужатие state), `compact.ts`
  (вопросы, решения, пересборка сообщений), `request.ts` (HTTP-запрос к
  OpenRouter и разбор `answers`), `client.ts` (`JevClient` поверх `fetch`).
- `hooks/fast-jev.ts` — адаптер к Claude Code: `session.compact` и
  `turn.complete`. Работает в песочнике движка: сеть только через `$.http.fetch`,
  ключ — из опции `apiKey`/`typesafeApiKey`, `$.env.get` переменной провайдера
  или `env` в settings.
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
