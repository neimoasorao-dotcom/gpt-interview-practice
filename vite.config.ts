import { defineConfig } from "vitest/config";
export default defineConfig({
  base: process.env.APP_BASE || "./",
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules\/(?:react|react-dom|scheduler)\//,
            },
          ],
        },
      },
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
