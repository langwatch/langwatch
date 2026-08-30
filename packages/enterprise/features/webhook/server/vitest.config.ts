import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Anchored aliases, not the object form.
 *
 * Vite's object alias is a PREFIX replacement, so mapping
 * `"@langwatch/observability"` to a file turns a subpath import
 * (`@langwatch/observability/metrics`, which `@langwatch/eventing`'s
 * process-manager gauges use) into `…/observability/src/index.ts/metrics` and
 * the suite dies on `ENOTDIR` before its first test. `find` as an anchored
 * regex matches the bare specifier only, and every subpath resolves through
 * the package's own `exports` map the way it does outside tests.
 */
const entryAlias = (name: string, path: string) => ({
  find: new RegExp(`^${name.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}$`),
  replacement: source(path),
});

export default defineConfig({
  resolve: {
    alias: [
      entryAlias("@langwatch/enterprise-webhook-contract", "../contract/src/index.ts"),
      entryAlias("@langwatch/eventing", "../../../../eventing/src/index.ts"),
      entryAlias("@langwatch/handled-error", "../../../../handled-error/src/index.ts"),
      entryAlias("@langwatch/observability", "../../../../observability/src/index.ts"),
    ],
  },
});
