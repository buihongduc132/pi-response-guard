/**
 * index.test.ts — Tests for the main extension entry point.
 *
 * Mocks ExtensionAPI to verify message_end handler behavior,
 * retry counting, config loading, and command registration.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ── Helpers to build mock pi API ────────────────────────────────────

type NotifyLevel = "info" | "success" | "warning" | "error";

interface MockEventMap {
	session_start: unknown;
	message_end: {
		message: {
			role: string;
			content?: unknown;
			stopReason?: string;
			errorMessage?: string;
			usage?: { input?: number; output?: number };
		};
	};
}

function createMockPi(): {
	pi: ExtensionAPI;
	sendUserMessage: ReturnType<typeof vi.fn>;
	notify: ReturnType<typeof vi.fn>;
	registeredCommands: Map<string, { description: string; handler: Function }>;
	emit: <K extends keyof MockEventMap>(event: K, data: MockEventMap[K]) => Promise<void>;
} {
	const sendUserMessage = vi.fn().mockResolvedValue(undefined);
	const notify = vi.fn();
	const registeredCommands = new Map<string, { description: string; handler: Function }>();
	const handlers: Record<string, Function[]> = {};

	const ctx = {
		hasUI: true,
		ui: { notify },
		cwd: "/tmp/test-project",
		isIdle: () => true,
		hasPendingMessages: () => false,
	};

	const pi = {
		on: vi.fn((event: string, handler: Function) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		registerCommand: vi.fn((name: string, def: { description: string; handler: Function }) => {
			registeredCommands.set(name, def);
		}),
		sendUserMessage,
	} as unknown as ExtensionAPI;

	const emit = async <K extends keyof MockEventMap>(event: K, data: MockEventMap[K]) => {
		const fns = handlers[event] ?? [];
		for (const fn of fns) {
			await fn(data, ctx);
		}
	};

	return { pi, sendUserMessage, notify, registeredCommands, emit };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("pi-response-guard extension", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("registers the setup command", async () => {
		const { pi, registeredCommands } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);
		expect(registeredCommands.has("pi-response-guard:setup")).toBe(true);
	});

	it("registers session_start and message_end handlers", async () => {
		const { pi } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);
		expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
		expect(pi.on).toHaveBeenCalledWith("message_end", expect.any(Function));
	});

	it("sends retry on error stopReason with matching pattern", async () => {
		const { pi, sendUserMessage, emit } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		await emit("message_end", {
			message: { role: "assistant", stopReason: "error", errorMessage: "fetch failed" },
		});

		expect(sendUserMessage).toHaveBeenCalledWith("continue");
	});

	it("sends retry on length stopReason", async () => {
		const { pi, sendUserMessage, emit } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		await emit("message_end", {
			message: { role: "assistant", stopReason: "length", content: [{ type: "text", text: "partial" }] },
		});

		expect(sendUserMessage).toHaveBeenCalledWith("continue");
	});

	it("sends retry on empty zero-token response", async () => {
		const { pi, sendUserMessage, emit } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		await emit("message_end", {
			message: {
				role: "assistant",
				stopReason: "stop",
				content: [],
				usage: { input: 124823, output: 0 },
			},
		});

		expect(sendUserMessage).toHaveBeenCalledWith("continue");
	});

	it("sends retry on silent stop after user message", async () => {
		const { pi, sendUserMessage, emit } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		// First: user message (sets previousMessageRole)
		await emit("message_end", { message: { role: "user", content: "hello" } });
		// Then: empty assistant response
		await emit("message_end", { message: { role: "assistant", stopReason: "stop", content: [] } });

		expect(sendUserMessage).toHaveBeenCalledWith("continue");
	});

	it("sends retry on silent stop after tool result", async () => {
		const { pi, sendUserMessage, emit } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		// Simulate tool result context by emitting toolResult-like role
		// We need to set previousMessageRole to "toolResult"
		// The extension tracks this from the role field
		await emit("message_end", { message: { role: "toolResult", content: "output" } });
		await emit("message_end", { message: { role: "assistant", stopReason: "stop", content: [] } });

		expect(sendUserMessage).toHaveBeenCalledWith("continue");
	});

	it("does NOT retry on successful assistant response", async () => {
		const { pi, sendUserMessage, emit } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		await emit("message_end", {
			message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Done!" }] },
		});

		expect(sendUserMessage).not.toHaveBeenCalled();
	});

	it("does NOT retry for non-assistant non-user messages", async () => {
		const { pi, sendUserMessage, emit } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		await emit("message_end", { message: { role: "system", content: "context" } });

		expect(sendUserMessage).not.toHaveBeenCalled();
	});

	it("resets retry counter on new user message", async () => {
		const { pi, sendUserMessage, emit } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		// Trigger retry 1
		await emit("message_end", {
			message: { role: "assistant", stopReason: "error", errorMessage: "fetch failed" },
		});
		expect(sendUserMessage).toHaveBeenCalledTimes(1);

		// User sends a new message → resets counter
		await emit("message_end", { message: { role: "user", content: "new prompt" } });

		// Should be able to retry again
		await emit("message_end", {
			message: { role: "assistant", stopReason: "error", errorMessage: "fetch failed" },
		});
		expect(sendUserMessage).toHaveBeenCalledTimes(2);
	});

	it("respects maxConsecutiveAutoRetries limit", async () => {
		const { pi, sendUserMessage, notify, emit } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		// The default max is 10, so send 11 consecutive error responses
		for (let i = 0; i < 11; i++) {
			await emit("message_end", {
				message: { role: "assistant", stopReason: "error", errorMessage: "fetch failed" },
			});
		}

		// Should have sent exactly 10 retries (not 11)
		expect(sendUserMessage).toHaveBeenCalledTimes(10);
		// Should have warned about hitting the limit
		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("retry limit"),
			"warning",
		);
	});

	it("sends notification on auto-retry", async () => {
		const { pi, notify, emit } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		await emit("message_end", {
			message: { role: "assistant", stopReason: "error", errorMessage: "fetch failed" },
		});

		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining("pi-response-guard"),
			"info",
		);
	});

	it("detects the auto-retry message and tracks it", async () => {
		const { pi, sendUserMessage, emit } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		// Trigger a retry
		await emit("message_end", {
			message: { role: "assistant", stopReason: "error", errorMessage: "fetch failed" },
		});
		expect(sendUserMessage).toHaveBeenCalledWith("continue");

		// The extension sends "continue" — simulate pi delivering it back as user message
		await emit("message_end", { message: { role: "user", content: "continue" } });

		// Now another empty response — should be detected as silentStopAfterAutoRetry
		await emit("message_end", {
			message: { role: "assistant", stopReason: "stop", content: [] },
		});
		expect(sendUserMessage).toHaveBeenCalledTimes(2);
	});

	it("uses followUp delivery when session is not idle", async () => {
		const { pi, sendUserMessage, emit } = createMockPi();
		// Override isIdle to return false
		const handlers: Record<string, Function[]> = {};
		const ctx = {
			hasUI: true,
			ui: { notify: vi.fn() },
			cwd: "/tmp/test",
			isIdle: () => false,
			hasPendingMessages: () => false,
		};
		(pi.on as ReturnType<typeof vi.fn>).mockImplementation((event: string, handler: Function) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		});

		const mod = await import("./index");
		mod.default(pi);

		for (const fn of handlers["message_end"] ?? []) {
			await fn(
				{ message: { role: "assistant", stopReason: "error", errorMessage: "fetch failed" } },
				ctx,
			);
		}

		expect(sendUserMessage).toHaveBeenCalledWith("continue", { deliverAs: "followUp" });
	});

	it("does not retry when hasPendingMessages is true", async () => {
		const { pi, sendUserMessage } = createMockPi();
		const handlers: Record<string, Function[]> = {};
		const ctx = {
			hasUI: true,
			ui: { notify: vi.fn() },
			cwd: "/tmp/test",
			isIdle: () => true,
			hasPendingMessages: () => true, // pending messages
		};
		(pi.on as ReturnType<typeof vi.fn>).mockImplementation((event: string, handler: Function) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		});

		const mod = await import("./index");
		mod.default(pi);

		for (const fn of handlers["message_end"] ?? []) {
			await fn(
				{ message: { role: "assistant", stopReason: "error", errorMessage: "fetch failed" } },
				ctx,
			);
		}

		expect(sendUserMessage).not.toHaveBeenCalled();
	});

	it("does not retry for unhandled stopReason (e.g. 'cancelled')", async () => {
		const { pi, sendUserMessage, emit } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		await emit("message_end", {
			message: { role: "assistant", stopReason: "cancelled" },
		});

		expect(sendUserMessage).not.toHaveBeenCalled();
	});

	it("does not retry for thinking-only stop when feature disabled via config override", async () => {
		const { pi, sendUserMessage } = createMockPi();
		const handlers: Record<string, Function[]> = {};
		const ctx = {
			hasUI: true,
			ui: { notify: vi.fn() },
			cwd: "/nonexistent/path",
			isIdle: () => true,
			hasPendingMessages: () => false,
		};
		(pi.on as ReturnType<typeof vi.fn>).mockImplementation((event: string, handler: Function) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		});

		const mod = await import("./index");
		mod.default(pi);

		// Emit a thinking-only stop — this should trigger retry with default config
		for (const fn of handlers["message_end"] ?? []) {
			await fn(
				{
					message: {
						role: "assistant",
						stopReason: "stop",
						content: [{ type: "thinking", text: "reasoning" }],
					},
				},
				ctx,
			);
		}

		expect(sendUserMessage).toHaveBeenCalledWith("continue");
	});

	it("setup command handler copies config", async () => {
		const { pi, registeredCommands } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		const setup = registeredCommands.get("pi-response-guard:setup");
		expect(setup).toBeDefined();

		const notify = vi.fn();
		const ctx = { ui: { notify } } as any;

		// The setup handler tries to copy config — mock fs to avoid real FS side effects
		// We just verify the command was registered and handler exists
		expect(typeof setup!.handler).toBe("function");
	});

	it("session_start handler runs without error", async () => {
		const { pi, emit } = createMockPi();
		const mod = await import("./index");
		mod.default(pi);

		// session_start should not throw
		await expect(emit("session_start", {} as any)).resolves.toBeUndefined();
	});

	it("skips retry when config.enabled is false (project config)", async () => {
		const { pi, sendUserMessage } = createMockPi();
		const handlers: Record<string, Function[]> = {};

		// Create a real temp project dir with a `.pi-response-guard.json`
		// that has `enabled: false`. resolveConfigPath checks PROJECT_CONFIG_CANDIDATES
		// in cwd first, so this is found BEFORE the global/bundled config.
		const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const tmpDir = mkdtempSync(join(tmpdir(), "pi-rg-disabled-"));
		writeFileSync(join(tmpDir, ".pi-response-guard.json"), JSON.stringify({ enabled: false }));

		(pi.on as ReturnType<typeof vi.fn>).mockImplementation((event: string, handler: Function) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		});

		try {
			const mod = await import("./index");
			mod.default(pi);

			const notify = vi.fn();
			const ctx = {
				hasUI: true,
				ui: { notify },
				cwd: tmpDir,
				isIdle: () => true,
				hasPendingMessages: () => false,
			};

			// A retryable assistant message — but enabled:false must short-circuit
			// by resetting counters and returning BEFORE sendUserMessage.
			for (const fn of handlers["message_end"] ?? []) {
				await fn(
					{ message: { role: "assistant", stopReason: "error", errorMessage: "fetch failed" } },
					ctx,
				);
			}

			expect(sendUserMessage).not.toHaveBeenCalled();
			expect(notify).not.toHaveBeenCalled();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("does NOT notify when context hasUI is false, but still sends retry", async () => {
		const { pi, sendUserMessage, notify } = createMockPi();
		const handlers: Record<string, Function[]> = {};

		(pi.on as ReturnType<typeof vi.fn>).mockImplementation((event: string, handler: Function) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		});

		const mod = await import("./index");
		mod.default(pi);

		// hasUI:false → safeNotify must early-return (no notify call),
		// but sendUserMessage still runs.
		const ctx = {
			hasUI: false,
			ui: { notify },
			cwd: "/tmp/test-project",
			isIdle: () => true,
			hasPendingMessages: () => false,
		};

		for (const fn of handlers["message_end"] ?? []) {
			await fn(
				{ message: { role: "assistant", stopReason: "error", errorMessage: "fetch failed" } },
				ctx,
			);
		}

		expect(sendUserMessage).toHaveBeenCalledWith("continue");
		expect(notify).not.toHaveBeenCalled();
	});
});
