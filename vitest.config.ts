import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/nodegram/gateway/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/nodegram/gateway/src/**/*.ts"],
      exclude: ["packages/nodegram/gateway/src/**/*.d.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
      reporter: ["text", "json-summary"],
    },
  },
});
