# pi-response-guard

[![npm version](https://img.shields.io/npm/v/pi-response-guard)](https://www.npmjs.com/package/pi-response-guard)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Auto-recovery for empty, errored, or interrupted model responses in [pi](https://pi.dev).

## Features

- **Empty response detection** — catches `stopReason: "stop"` with 0 output tokens (rate limit / proxy failures)
- **Auto-retry** — sends a configurable retry message so the session never stalls
- **Rate limit recovery** — matches 429, rate limit, usage limit, and other provider error patterns
- **Token overflow handling** — auto-continues when the model hits max output tokens (`stopReason: "length"`)
- **7 detection cases** — covers error patterns, length limits, thinking-only stops, silent stops after user/tool/auto-retry, and zero-token empty responses

## Installation

### For Humans

```bash
npm install pi-response-guard
```

### For AI Agents

Add to your pi `settings.json` packages array:

```json
{
  "packages": ["npm:pi-response-guard"]
}
```

Install and configure pi-response-guard by following: https://raw.githubusercontent.com/buihongduc132/pi-response-guard/refs/heads/main/README.md

### For pi (git-sourced)

Add to your pi `settings.json` packages array:

```json
{
  "packages": ["https://github.com/buihongduc132/pi-response-guard"]
}
```

## Usage

`pi-response-guard` runs automatically once installed — no configuration required. It listens to every assistant message and detects retryable conditions:

| # | Condition | Description |
|---|-----------|-------------|
| 1 | **Error pattern match** | `stopReason: "error"` with a message matching configured error substrings (rate limit, fetch failed, ECONNRESET, etc.) |
| 2 | **Token overflow** | `stopReason: "length"` — model hit max output tokens |
| 3 | **Thinking-only stop** | Model stopped after emitting only thinking content, with no visible output |
| 4 | **Silent stop after user** | Model stopped after a user message with no visible output |
| 5 | **Silent stop after tool** | Model stopped after a tool result with no visible output |
| 6 | **Silent stop after auto-retry** | Consecutive empty response following an automatic retry |
| 7 | **Zero-token empty response** | `stopReason: "stop"` with `usage.output === 0` — rate limit or proxy failure |

When detected, the extension sends a configurable retry message (default: `"continue"`) up to a maximum number of consecutive retries.

## Configuration

Default config is bundled. To customize, run:

```
/pi-response-guard:setup
```

This copies the default config to `~/.pi/agent/extensions/pi-response-guard/config.json`.

Or create a project-level config at `.pi-response-guard.json` or `.pi/pi-response-guard.json`.

### Config Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable the extension |
| `retryMessage` | `string` | `"continue"` | Message sent to trigger retry |
| `maxConsecutiveAutoRetries` | `number` | `10` | Max retries before stopping |
| `notifyOnAutoContinue` | `boolean` | `true` | Show UI notification on retry |
| `autoContinueOnLength` | `boolean` | `true` | Retry on `stopReason: "length"` |
| `autoContinueOnThinkingOnlyStop` | `boolean` | `true` | Retry when only thinking emitted |
| `autoContinueOnSilentStopAfterTool` | `boolean` | `true` | Retry on silent stop after user/tool |
| `autoContinueOnEmptyResponse` | `boolean` | `true` | Retry on 0 output token responses |
| `errorPatterns` | `string[]` | *(see config.json)* | Substrings to match in error messages |

## License

MIT
