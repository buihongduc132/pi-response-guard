/**
 * guard-logic.test.ts — Comprehensive tests for guard-logic.ts
 *
 * Covers: normalizeConfig, extractUserText, matchesConfiguredError,
 * hasVisibleAssistantOutput, isThinkingOnlyStop, isEmptyZeroTokenResponse,
 * getAutoContinueReason (all 7 cases + edge cases).
 */
import { describe, it, expect } from "vitest";
import {
	DEFAULT_CONFIG,
	normalizeConfig,
	extractUserText,
	matchesConfiguredError,
	hasVisibleAssistantOutput,
	isThinkingOnlyStop,
	isEmptyZeroTokenResponse,
	getAutoContinueReason,
	type AutoContinueConfig,
	type GuardMessage,
	type GuardContext,
} from "./guard-logic";

// ── Fixtures ────────────────────────────────────────────────────────

const enabledConfig: AutoContinueConfig = { ...DEFAULT_CONFIG };

const ctxAfterUser: GuardContext = { previousMessageRole: "user", previousMessageWasAutoRetry: false };
const ctxAfterTool: GuardContext = { previousMessageRole: "toolResult" };
const ctxAfterAutoRetry: GuardContext = { previousMessageRole: "user", previousMessageWasAutoRetry: true };

// ── normalizeConfig ─────────────────────────────────────────────────

describe("normalizeConfig", () => {
	it("returns defaults for null input", () => {
		const config = normalizeConfig(null);
		expect(config.enabled).toBe(true);
		expect(config.retryMessage).toBe("continue");
		expect(config.maxConsecutiveAutoRetries).toBe(10);
		expect(config.autoContinueOnEmptyResponse).toBe(true);
	});

	it("returns defaults for undefined input", () => {
		const config = normalizeConfig(undefined);
		expect(config.retryMessage).toBe("continue");
	});

	it("returns defaults for non-object input", () => {
		expect(normalizeConfig("hello").retryMessage).toBe("continue");
		expect(normalizeConfig(42).retryMessage).toBe("continue");
	});

	it("merges partial overrides", () => {
		const config = normalizeConfig({ enabled: false, retryMessage: "try again" });
		expect(config.enabled).toBe(false);
		expect(config.retryMessage).toBe("try again");
		expect(config.maxConsecutiveAutoRetries).toBe(10); // default
	});

	it("clamps maxConsecutiveAutoRetries to 0 minimum", () => {
		const config = normalizeConfig({ maxConsecutiveAutoRetries: -5 });
		expect(config.maxConsecutiveAutoRetries).toBe(0);
	});

	it("floors maxConsecutiveAutoRetries", () => {
		const config = normalizeConfig({ maxConsecutiveAutoRetries: 3.7 });
		expect(config.maxConsecutiveAutoRetries).toBe(3);
	});

	it("rejects non-finite maxConsecutiveAutoRetries", () => {
		const config = normalizeConfig({ maxConsecutiveAutoRetries: Infinity });
		expect(config.maxConsecutiveAutoRetries).toBe(10); // fallback to default
	});

	it("rejects empty retryMessage", () => {
		const config = normalizeConfig({ retryMessage: "   " });
		expect(config.retryMessage).toBe("continue"); // fallback
	});

	it("filters empty errorPatterns and falls back to defaults", () => {
		const config = normalizeConfig({ errorPatterns: ["", "  "] });
		expect(config.errorPatterns).toEqual(DEFAULT_CONFIG.errorPatterns);
	});

	it("accepts custom errorPatterns", () => {
		const config = normalizeConfig({ errorPatterns: ["my-error"] });
		expect(config.errorPatterns).toEqual(["my-error"]);
	});

	it("handles boolean fields correctly", () => {
		const config = normalizeConfig({
			enabled: false,
			notifyOnAutoContinue: false,
			autoContinueOnLength: false,
			autoContinueOnThinkingOnlyStop: false,
			autoContinueOnSilentStopAfterTool: false,
			autoContinueOnEmptyResponse: false,
		});
		expect(config.enabled).toBe(false);
		expect(config.notifyOnAutoContinue).toBe(false);
		expect(config.autoContinueOnLength).toBe(false);
		expect(config.autoContinueOnThinkingOnlyStop).toBe(false);
		expect(config.autoContinueOnSilentStopAfterTool).toBe(false);
		expect(config.autoContinueOnEmptyResponse).toBe(false);
	});

	it("ignores non-boolean boolean fields", () => {
		const config = normalizeConfig({ enabled: "yes" });
		expect(config.enabled).toBe(true); // fallback to default
	});

	it("ignores non-number maxConsecutiveAutoRetries", () => {
		const config = normalizeConfig({ maxConsecutiveAutoRetries: "many" });
		expect(config.maxConsecutiveAutoRetries).toBe(10);
	});

	it("filters non-string errorPatterns", () => {
		const config = normalizeConfig({ errorPatterns: [123, true, "valid", null] as unknown as string[] });
		expect(config.errorPatterns).toEqual(["valid"]);
	});
});

// ── extractUserText ─────────────────────────────────────────────────

describe("extractUserText", () => {
	it("extracts from string content", () => {
		expect(extractUserText("hello world")).toBe("hello world");
	});

	it("trims string content", () => {
		expect(extractUserText("  hello  ")).toBe("hello");
	});

	it("extracts from content blocks", () => {
		const content = [{ type: "text", text: "hello" }, { type: "text", text: "world" }];
		expect(extractUserText(content)).toBe("hello\nworld");
	});

	it("ignores non-text blocks", () => {
		const content = [{ type: "image", url: "http://..." }];
		expect(extractUserText(content)).toBe("");
	});

	it("returns empty for null/undefined", () => {
		expect(extractUserText(null)).toBe("");
		expect(extractUserText(undefined)).toBe("");
	});

	it("returns empty for number", () => {
		expect(extractUserText(42)).toBe("");
	});

	it("handles mixed valid and invalid blocks", () => {
		const content = [null, { type: "text", text: "ok" }, { type: "other" }, "string"];
		expect(extractUserText(content)).toBe("ok");
	});
});

// ── matchesConfiguredError ──────────────────────────────────────────

describe("matchesConfiguredError", () => {
	it("matches case-insensitively", () => {
		expect(matchesConfiguredError("FETCH FAILED", ["fetch failed"])).toBe(true);
	});

	it("matches substring", () => {
		expect(matchesConfiguredError("Error: fetch failed due to network", ["fetch failed"])).toBe(true);
	});

	it("returns false when no pattern matches", () => {
		expect(matchesConfiguredError("all good", ["fetch failed"])).toBe(false);
	});

	it("matches rate limit patterns", () => {
		expect(matchesConfiguredError("Usage limit reached for 5 hour", ["usage limit"])).toBe(true);
		expect(matchesConfiguredError("RateLimitError: rate limit exceeded", ["rate limit"])).toBe(true);
	});

	it("returns false for empty error text", () => {
		expect(matchesConfiguredError("", ["fetch failed"])).toBe(false);
	});
});

// ── hasVisibleAssistantOutput ───────────────────────────────────────

describe("hasVisibleAssistantOutput", () => {
	it("detects text content", () => {
		expect(hasVisibleAssistantOutput([{ type: "text", text: "hello" }])).toBe(true);
	});

	it("detects toolCall content", () => {
		expect(hasVisibleAssistantOutput([{ type: "toolCall", name: "bash" }])).toBe(true);
	});

	it("returns false for empty array", () => {
		expect(hasVisibleAssistantOutput([])).toBe(false);
	});

	it("returns false for thinking-only content", () => {
		expect(hasVisibleAssistantOutput([{ type: "thinking", text: "hmm" }])).toBe(false);
	});

	it("returns false for non-array", () => {
		expect(hasVisibleAssistantOutput(null)).toBe(false);
		expect(hasVisibleAssistantOutput("text")).toBe(false);
	});

	it("returns false for array with only non-visible blocks", () => {
		expect(hasVisibleAssistantOutput([{ type: "image", url: "x" }])).toBe(false);
	});
});

// ── isThinkingOnlyStop ──────────────────────────────────────────────

describe("isThinkingOnlyStop", () => {
	it("detects thinking-only content", () => {
		expect(isThinkingOnlyStop([{ type: "thinking", text: "reasoning..." }])).toBe(true);
	});

	it("returns false when text is also present", () => {
		expect(isThinkingOnlyStop([
			{ type: "thinking", text: "reasoning..." },
			{ type: "text", text: "answer" },
		])).toBe(false);
	});

	it("returns false when toolCall is also present", () => {
		expect(isThinkingOnlyStop([
			{ type: "thinking", text: "reasoning..." },
			{ type: "toolCall", name: "bash" },
		])).toBe(false);
	});

	it("returns false for empty content", () => {
		expect(isThinkingOnlyStop([])).toBe(false);
	});

	it("returns false for non-thinking content", () => {
		expect(isThinkingOnlyStop([{ type: "text", text: "hello" }])).toBe(false);
	});
});

// ── isEmptyZeroTokenResponse ────────────────────────────────────────

describe("isEmptyZeroTokenResponse", () => {
	it("detects stop + 0 output + empty content", () => {
		const msg: GuardMessage = {
			stopReason: "stop",
			content: [],
			usage: { input: 124823, output: 0 },
		};
		expect(isEmptyZeroTokenResponse(msg)).toBe(true);
	});

	it("detects the EXACT session failure case", () => {
		// This is the actual shape from session 019e0d52
		const msg: GuardMessage = {
			stopReason: "stop",
			content: [],
			usage: { input: 124823, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
		expect(isEmptyZeroTokenResponse(msg)).toBe(true);
	});

	it("returns false for non-stop stopReason", () => {
		expect(isEmptyZeroTokenResponse({ stopReason: "error", usage: { output: 0 } })).toBe(false);
	});

	it("returns false for non-zero output", () => {
		expect(isEmptyZeroTokenResponse({ stopReason: "stop", usage: { output: 50 } })).toBe(false);
	});

	it("returns false when usage is missing", () => {
		expect(isEmptyZeroTokenResponse({ stopReason: "stop" })).toBe(false);
	});

	it("returns false when content has visible output", () => {
		const msg: GuardMessage = {
			stopReason: "stop",
			content: [{ type: "text", text: "hello" }],
			usage: { output: 0 },
		};
		expect(isEmptyZeroTokenResponse(msg)).toBe(false);
	});

	it("returns false when output is undefined in usage", () => {
		const msg: GuardMessage = {
			stopReason: "stop",
			usage: { input: 100 },
		};
		expect(isEmptyZeroTokenResponse(msg)).toBe(false);
	});
});

// ── getAutoContinueReason — Case 1: error patterns ─────────────────

describe("getAutoContinueReason — error pattern matching", () => {
	it("matches error stopReason with configured pattern", () => {
		const msg: GuardMessage = { stopReason: "error", errorMessage: "fetch failed" };
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason?.kind).toBe("error");
	});

	it("matches rate limit error", () => {
		const msg: GuardMessage = { stopReason: "error", errorMessage: "Usage limit reached for 5 hour" };
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason?.kind).toBe("error");
	});

	it("matches 429 error", () => {
		const msg: GuardMessage = { stopReason: "error", errorMessage: "HTTP 429 too many requests" };
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason?.kind).toBe("error");
	});

	it("does not match when errorMessage is missing", () => {
		const msg: GuardMessage = { stopReason: "error" };
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason).toBeUndefined();
	});

	it("does not match when pattern doesn't match", () => {
		const msg: GuardMessage = { stopReason: "error", errorMessage: "unknown error type" };
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason).toBeUndefined();
	});

	it("extracts error text from content blocks", () => {
		const msg: GuardMessage = {
			stopReason: "error",
			content: [{ type: "text", text: "fetch failed during stream" }],
		};
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason?.kind).toBe("error");
	});

	it("prefers errorMessage over content text", () => {
		const msg: GuardMessage = {
			stopReason: "error",
			errorMessage: "rate limit exceeded",
			content: [{ type: "text", text: "fetch failed" }],
		};
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason?.kind).toBe("error");
	});
});

// ── getAutoContinueReason — Case 2: length ─────────────────────────

describe("getAutoContinueReason — length stop", () => {
	it("detects length stopReason", () => {
		const msg: GuardMessage = { stopReason: "length", content: [{ type: "text", text: "partial" }] };
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason?.kind).toBe("length");
	});

	it("skips when autoContinueOnLength is disabled", () => {
		const config = { ...enabledConfig, autoContinueOnLength: false };
		const msg: GuardMessage = { stopReason: "length" };
		const reason = getAutoContinueReason(msg, config, ctxAfterUser);
		expect(reason).toBeUndefined();
	});
});

// ── getAutoContinueReason — Case 3: thinking-only stop ─────────────

describe("getAutoContinueReason — thinking-only stop", () => {
	it("detects thinking-only stop", () => {
		const msg: GuardMessage = {
			stopReason: "stop",
			content: [{ type: "thinking", text: "reasoning..." }],
		};
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason?.kind).toBe("thinkingOnlyStop");
	});

	it("skips when autoContinueOnThinkingOnlyStop is disabled", () => {
		const config = { ...enabledConfig, autoContinueOnThinkingOnlyStop: false, autoContinueOnSilentStopAfterTool: false, autoContinueOnEmptyResponse: false };
		const msg: GuardMessage = {
			stopReason: "stop",
			content: [{ type: "thinking", text: "reasoning..." }],
		};
		const reason = getAutoContinueReason(msg, config, ctxAfterUser);
		expect(reason).toBeUndefined();
	});
});

// ── getAutoContinueReason — Case 7: empty zero-token response ──────

describe("getAutoContinueReason — empty zero-token response", () => {
	it("detects 0-output-token empty response", () => {
		const msg: GuardMessage = {
			stopReason: "stop",
			content: [],
			usage: { input: 124823, output: 0 },
		};
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason?.kind).toBe("emptyZeroTokenResponse");
	});

	it("detects the EXACT session failure (rate limit + empty)", () => {
		// This is the exact shape from the session that died
		const msg: GuardMessage = {
			stopReason: "stop",
			content: [],
			usage: { input: 124823, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason?.kind).toBe("emptyZeroTokenResponse");
		expect(reason?.notification).toContain("rate limit");
	});

	it("skips when autoContinueOnEmptyResponse is disabled", () => {
		const config = { ...enabledConfig, autoContinueOnEmptyResponse: false, autoContinueOnSilentStopAfterTool: false };
		const msg: GuardMessage = {
			stopReason: "stop",
			content: [],
			usage: { output: 0 },
		};
		const reason = getAutoContinueReason(msg, config, ctxAfterUser);
		expect(reason).toBeUndefined();
	});

	it("falls through to silentStopAfterUser for non-zero output with empty content", () => {
		const msg: GuardMessage = {
			stopReason: "stop",
			content: [],
			usage: { output: 50 },
		};
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		// Not emptyZeroTokenResponse (output > 0), but still silent stop after user
		expect(reason?.kind).toBe("silentStopAfterUser");
	});
});

// ── getAutoContinueReason — Case 4: silent stop after user ─────────

describe("getAutoContinueReason — silent stop after user", () => {
	it("detects silent stop after user message", () => {
		const msg: GuardMessage = { stopReason: "stop", content: [] };
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason?.kind).toBe("silentStopAfterUser");
	});

	it("skips when assistant has visible output", () => {
		const msg: GuardMessage = { stopReason: "stop", content: [{ type: "text", text: "hello" }] };
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason).toBeUndefined();
	});
});

// ── getAutoContinueReason — Case 5: silent stop after tool ─────────

describe("getAutoContinueReason — silent stop after tool", () => {
	it("detects silent stop after tool result", () => {
		const msg: GuardMessage = { stopReason: "stop", content: [] };
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterTool);
		expect(reason?.kind).toBe("silentStopAfterTool");
	});
});

// ── getAutoContinueReason — Case 6: silent stop after auto-retry ───

describe("getAutoContinueReason — silent stop after auto-retry", () => {
	it("detects silent stop after auto-retry message", () => {
		const msg: GuardMessage = { stopReason: "stop", content: [] };
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterAutoRetry);
		expect(reason?.kind).toBe("silentStopAfterAutoRetry");
	});
});

// ── getAutoContinueReason — priority / edge cases ──────────────────

describe("getAutoContinueReason — edge cases", () => {
	it("returns undefined for unhandled stopReason", () => {
		const msg: GuardMessage = { stopReason: "cancelled" };
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason).toBeUndefined();
	});

	it("returns undefined when stopReason is missing", () => {
		const msg: GuardMessage = {};
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason).toBeUndefined();
	});

	it("returns undefined when config is disabled", () => {
		const config = { ...enabledConfig, autoContinueOnSilentStopAfterTool: false };
		const msg: GuardMessage = { stopReason: "stop", content: [] };
		// No usage → not emptyZeroTokenResponse, no thinking → not thinkingOnlyStop
		// autoContinueOnSilentStopAfterTool is false → skip cases 4-6
		const reason = getAutoContinueReason(msg, config, ctxAfterUser);
		expect(reason).toBeUndefined();
	});

	it("returns undefined when all disable flags are off and content is empty", () => {
		const config = {
			...enabledConfig,
			autoContinueOnThinkingOnlyStop: false,
			autoContinueOnSilentStopAfterTool: false,
			autoContinueOnEmptyResponse: false,
		};
		const msg: GuardMessage = { stopReason: "stop", content: [] };
		const reason = getAutoContinueReason(msg, config, ctxAfterUser);
		expect(reason).toBeUndefined();
	});

	it("prioritizes error over other cases", () => {
		const msg: GuardMessage = {
			stopReason: "error",
			errorMessage: "fetch failed",
			content: [],
			usage: { output: 0 },
		};
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason?.kind).toBe("error");
	});

	it("prioritizes length over stop cases", () => {
		const msg: GuardMessage = {
			stopReason: "length",
			content: [{ type: "text", text: "partial" }],
		};
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason?.kind).toBe("length");
	});

	it("prioritizes thinking-only over empty-response", () => {
		// Thinking-only content, no usage → thinkingOnlyStop takes priority
		const msg: GuardMessage = {
			stopReason: "stop",
			content: [{ type: "thinking", text: "reasoning" }],
		};
		const reason = getAutoContinueReason(msg, enabledConfig, ctxAfterUser);
		expect(reason?.kind).toBe("thinkingOnlyStop");
	});

	it("handles missing previousMessageRole", () => {
		const msg: GuardMessage = { stopReason: "stop", content: [] };
		const reason = getAutoContinueReason(msg, enabledConfig, {});
		// Falls through all checks — no previous role matches cases 4-6
		// But emptyZeroTokenResponse should NOT trigger without usage
		expect(reason).toBeUndefined();
	});

	it("handles unknown previousMessageRole", () => {
		const msg: GuardMessage = { stopReason: "stop", content: [] };
		const reason = getAutoContinueReason(msg, enabledConfig, { previousMessageRole: "system" });
		expect(reason).toBeUndefined();
	});
});

// ── DEFAULT_CONFIG structure ────────────────────────────────────────

describe("DEFAULT_CONFIG", () => {
	it("has all required fields", () => {
		expect(DEFAULT_CONFIG).toHaveProperty("enabled");
		expect(DEFAULT_CONFIG).toHaveProperty("retryMessage");
		expect(DEFAULT_CONFIG).toHaveProperty("maxConsecutiveAutoRetries");
		expect(DEFAULT_CONFIG).toHaveProperty("notifyOnAutoContinue");
		expect(DEFAULT_CONFIG).toHaveProperty("autoContinueOnLength");
		expect(DEFAULT_CONFIG).toHaveProperty("autoContinueOnThinkingOnlyStop");
		expect(DEFAULT_CONFIG).toHaveProperty("autoContinueOnSilentStopAfterTool");
		expect(DEFAULT_CONFIG).toHaveProperty("autoContinueOnEmptyResponse");
		expect(DEFAULT_CONFIG).toHaveProperty("errorPatterns");
	});

	it("has rate limit patterns", () => {
		expect(DEFAULT_CONFIG.errorPatterns).toContain("rate limit");
		expect(DEFAULT_CONFIG.errorPatterns).toContain("usage limit");
		expect(DEFAULT_CONFIG.errorPatterns).toContain("rate_limit");
	});

	it("has connection error patterns", () => {
		expect(DEFAULT_CONFIG.errorPatterns).toContain("fetch failed");
		expect(DEFAULT_CONFIG.errorPatterns).toContain("ECONNRESET");
		expect(DEFAULT_CONFIG.errorPatterns).toContain("socket hang up");
	});

	it("maxConsecutiveAutoRetries is 10", () => {
		expect(DEFAULT_CONFIG.maxConsecutiveAutoRetries).toBe(10);
	});
});
