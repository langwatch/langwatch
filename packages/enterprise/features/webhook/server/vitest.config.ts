import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
 *
 * The four entries are spelled out rather than built by a helper because this
 * table is read statically as well as run: `@langwatch/test-harness`'s
 * `parseVitestConfigAliases` resolves every `vi.mock` specifier in the package
 * against it, and it reads literals, not the result of calling a local
 * function. A table it cannot read is one it refuses rather than skips, since
 * a dropped alias makes the mock check go quiet about exactly the files it
 * exists to check.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@langwatch\/enterprise-webhook-contract$/,
        replacement: fileURLToPath(new URL("../contract/src/index.ts", import.meta.url)),
      },
      {
        find: /^@langwatch\/eventing$/,
        replacement: fileURLToPath(new URL("../../../../eventing/src/index.ts", import.meta.url)),
      },
      {
        find: /^@langwatch\/handled-error$/,
        replacement: fileURLToPath(
          new URL("../../../../handled-error/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@langwatch\/observability$/,
        replacement: fileURLToPath(
          new URL("../../../../observability/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
});
