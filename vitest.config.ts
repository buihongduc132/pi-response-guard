import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["**/*.test.ts"],
		coverage: {
			include: ["index.ts", "guard-logic.ts"],
			thresholds: {
				statements: 80,
				branches: 80,
				functions: 80,
				lines: 80,
			},
			reporter: ["text", "json-summary"],
		},
	},
});
