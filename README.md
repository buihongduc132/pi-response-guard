# pi-response-guard

[![npm version](https://img.shields.io/npm/v/pi-response-guard)](https://www.npmjs.com/package/pi-response-guard)
[![npm downloads](https://img.shields.io/npm/dm/pi-response-guard)](https://www.npmjs.com/package/pi-response-guard)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

A [pi](https://pi.dev) extension that auto-recovers from empty, errored, or interrupted model responses.

When a model returns an empty response (0 output tokens), hits a rate limit, gets disconnected mid-stream, or stops without visible output — `pi-response-guard` automatically sends a configurable retry message like `continue` so the session doesn't stall.

## Why?

Pi's built-in retry only covers `stopReason === "error"`. When a provider returns `stopReason: "stop"` with 0 output tokens (e.g., due to rate limiting through a proxy like LiteLLM), pi treats it as a successful response and waits for user input. This extension detects that case and auto-recovers.

## Features

- **Empty response detection**: Catches `stopReason: "stop"` with 0 output tokens (rate limit / proxy failures)
- **Error pattern matching**: Configurable substring patterns for `stopReason: "error"` (rate limit, fetch failed, ECONNRESET, etc.)
- **Length limit**: Auto-continues when model hits max output tokens
- **Thinking-only stop**: Continues when model only emitted thinking content
- **Silent stop**: Continues when model stops after user/tool message with no visible output
- **Retry limit**: Configurable max consecutive retries (default: 10)
- **UI notifications**: Shows when auto-retry happens

## Installation

Add to your pi `settings.json`:

```json
{
  "packages": ["npm:pi-response-guard"]
}
```

Or install globally:

```bash
npm install -g pi-response-guard
```

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

## Detection Cases

| # | Condition | Detection |
|---|-----------|-----------|
| 1 | `stopReason: "error"` + matching error pattern | Configurable substring match |
| 2 | `stopReason: "length"` | Hit max output tokens |
| 3 | `stopReason: "stop"` + thinking-only content | No text or tool calls |
| 4 | `stopReason: "stop"` + empty after user message | No visible output |
| 5 | `stopReason: "stop"` + empty after tool result | No visible output |
| 6 | `stopReason: "stop"` + empty after auto-retry | Consecutive empty response |
| 7 | `stopReason: "stop"` + `usage.output === 0` | **NEW**: Rate limit / proxy failure |

## Credits

Inspired by [pi-hodor](https://github.com/vurihuang/pi-hodor) by vurihuang, with additional detection for rate-limit empty responses.

## License

MIT
