/**
 * setup-command.test.ts — Coverage for the `pi-response-guard:setup`
 * command handler body in index.ts (lines 127-135) plus the inline
 * default-write fallback in ensureBundledConfigFile (lines 58-80).
 *
 * Uses a top-level `vi.mock("node:fs/promises", ...)` so the named
 * imports `access`, `copyFile`, `mkdir`, `writeFile`, `readFile` that
 * index.ts pulls in are controllable per-test. This lives in its own
 * file to avoid clashing with index.test.ts's `vi.resetModules()` +
 * dynamic `import("./index")` pattern.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { access, copyFile, mkdir, writeFile } from "node:fs/promises";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		access: vi.fn(),
		copyFile: vi.fn(),
		mkdir: vi.fn(),
		writeFile: vi.fn(),
	};
});

// Re-expose the mocked fns as typed mocks.
const mockAccess = vi.mocked(access);
const mockCopyFile = vi.mocked(copyFile);
const mockMkdir = vi.mocked(mkdir);
const mockWriteFile = vi.mocked(writeFile);

// ── Minimal pi harness: capture the registered setup handler ─────────

function buildHarness(): {
	pi: ExtensionAPI;
	registeredCommands: Map<string, { description: string; handler: Function }>;
} {
	const registeredCommands = new Map<string, { description: string; handler: Function }>();
	const pi = {
		on: vi.fn(),
		registerCommand: vi.fn((name: string, def: { description: string; handler: Function }) => {
			registeredCommands.set(name, def);
		}),
		sendUserMessage: vi.fn().mockResolvedValue(undefined),
	} as unknown as ExtensionAPI;
	return { pi, registeredCommands };
}

describe("pi-response-guard :setup command handler (fs-mocked)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: nothing exists, all writes succeed.
		mockAccess.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
		mockWriteFile.mockResolvedValue(undefined);
		mockMkdir.mockResolvedValue(undefined);
		mockCopyFile.mockResolvedValue(undefined);
	});

	it("warns and returns when a global config already exists", async () => {
		// access resolves for every path → pathExists(GLOBAL_CONFIG_PATH) === true.
		mockAccess.mockResolvedValue(undefined);

		const { pi, registeredCommands } = buildHarness();
		const mod = await import("./index");
		mod.default(pi);

		const setup = registeredCommands.get("pi-response-guard:setup");
		expect(setup).toBeDefined();

		const notify = vi.fn();
		// Setup handler only touches ctx.ui.notify.
		const ctx = { ui: { notify } } as any;

		await setup!.handler(undefined, ctx);

		expect(notify).toHaveBeenCalledWith(expect.stringContaining("already exists"), "warning");
		// Must NOT have proceeded to copy.
		expect(mockCopyFile).not.toHaveBeenCalled();
		expect(mockMkdir).not.toHaveBeenCalled();
		expect(mockWriteFile).not.toHaveBeenCalled();
	});

	it("copies the bundled config to the global path when none exists", async () => {
		// access throws for every path:
		//  - pathExists(GLOBAL_CONFIG_PATH) === false → proceed
		//  - ensureBundledConfigFile() sees access(BUNDLED) throw → writes
		//    inline defaults via writeFile (exercises lines 58-80).
		// (default beforeEach already makes access reject everywhere)

		const { pi, registeredCommands } = buildHarness();
		const mod = await import("./index");
		mod.default(pi);

		const setup = registeredCommands.get("pi-response-guard:setup");
		expect(setup).toBeDefined();

		const notify = vi.fn();
		const ctx = { ui: { notify } } as any;

		await setup!.handler(undefined, ctx);

		// ensureBundledConfigFile wrote the default config JSON.
		expect(mockWriteFile).toHaveBeenCalledTimes(1);
		// Directory for the global config created recursively.
		expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
		// Bundled config copied to global path.
		expect(mockCopyFile).toHaveBeenCalledWith(expect.any(String), expect.any(String));
		// Success notify at "info" level.
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("copied to"), "info");
	});
});
