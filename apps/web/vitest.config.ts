import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));
const at = (p: string) => resolve(here, p) + "/";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["ce/**/*.spec.ts", "core/**/*.spec.ts"],
  },
  // Mirror the tsconfig path aliases (most specific first).
  resolve: {
    alias: [
      { find: /^@\/plane-web\//, replacement: at("ce") },
      { find: /^@\/app\//, replacement: at("app") },
      { find: /^@\/helpers\//, replacement: at("helpers") },
      { find: /^@\/styles\//, replacement: at("styles") },
      { find: /^@\//, replacement: at("core") },
    ],
  },
});
