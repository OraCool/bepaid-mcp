import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"], // stdio entrypoint only, exercised via createServer in tests
      reporter: ["text-summary", "lcov"],
    },
  },
});
