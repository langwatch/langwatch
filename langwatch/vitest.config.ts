import { config } from "dotenv";
import { join } from "path";
import { configDefaults, defineConfig } from "vitest/config";

config();

export default defineConfig({
  test: {
    // The workspace packages export TypeScript SOURCE (`exports` → `src/*.ts`),
    // so they must be transformed by vite rather than handed to node's
    // resolver — externalised, `import "@langwatch/langy"` resolves to a
    // .ts file node cannot load, and vitest reports it as unresolvable.
    //
    // This lived under `resolve.server`, which is not a real option — `resolve`
    // takes no `server` key. It typechecked only until something made the
    // overload resolve strictly, and it had never been read there. Vitest reads
    // it here. It is the same concern as `server.fs.allow` below: inlining is
    // what makes vite READ these files, and therefore what makes the allowlist
    // matter at all.
    server: {
      deps: {
        inline: [
          /@langwatch\/(langy|handled-error|automations|observability)/,
        ],
      },
    },
    watch: false,
    // vmForks over vmThreads: the VM context leaks memory by design, but a
    // forked child reclaims ALL of it on exit, whereas a worker THREAD's leak
    // accumulates in the shared process heap. Measured on src/features/traces-v2
    // (68 files): peak RSS 2.56GB (vmThreads) -> 573MB (vmForks), ~4.5x, for
    // ~15% more wall-clock. vmMemoryLimit still recycles a worker before its
    // context grows unbounded. See dev/docs/best_practices/vitest-performance.md.
    pool: "vmForks",
    maxWorkers: "50%", // Low default for local dev; CI overrides with VITEST_MAX_WORKERS
    vmMemoryLimit: "512MB", // Recycle a worker once its reused VM context hits this
    // isolate:false reuses one VM context across the files in a worker instead
    // of building a fresh module registry per file. Safe here because the suite
    // resets shared state between tests (test-setup.ts + clearMocks-style
    // cleanup), so cross-file leakage doesn't change results — verified across
    // 172 sampled files (traces-v2 + a broad server slice) with zero failures.
    // The full-suite CI test-unit shards are the scale check; if isolate:false
    // ever flakes a shard, drop this line first.
    isolate: false,
    testTimeout: 30000, // 30s default to handle slower CI runners
    // Global setup runs once before all tests. Unit needs no containers; this
    // only carries a CI-gated hard-floor that mirrors the integration
    // globalSetup, releasing the vitest finalize wedge on unit shards (which
    // otherwise lack a hard-floor → 25-min job timeout → app-ci cancel).
    globalSetup: ["./src/test-unit-global-setup.ts"],
    setupFiles: ["./test-setup.ts"],
    exclude: [
      ...configDefaults.exclude,
      "**/*.integration.test.{ts,tsx}",
      "**/*.stress.test.{ts,tsx}",
      "**/*.scenario.test.{ts,tsx}",
      "**/*.browser.test.{ts,tsx}",
      ".next/**/*",
      ".next-saas/**/*",
      "**/e2e/**/*",
    ],
    env: {
      /*
       * @see src/server/redis.ts, lines 8-11
       * This is to prevent the redis connection from being established during the test run.
       */
      BUILD_TIME: "1",
      // Skip t3-oss/env-nextjs validation - it throws when server env vars are
      // accessed from jsdom context (which it considers "client")
      SKIP_ENV_VALIDATION: "1",
    },
    experimental: {
      fsModuleCache: true,
    },
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  server: {
    fs: {
      // Vite refuses to READ a file that is neither inside `fs.allow` nor in
      // its `safeModulePaths` set. `fs.allow` defaults to
      // `searchForWorkspaceRoot(root)`, and because `langwatch/` carries its
      // OWN `pnpm-workspace.yaml`, that search stops HERE — so the
      // source-only workspace packages one level up (`../packages/langy`,
      // `../packages/handled-error`, `../mcp-server`) are outside the
      // allowlist. They still loaded, but only by accident: vite's
      // import-analysis adds every specifier it resolves to `safeModulePaths`,
      // so each langy file was "allowed" solely because vite had just
      // transformed the file importing it.
      //
      // `experimental.fsModuleCache` breaks that accident. A cached importer
      // is replayed straight from disk and never goes through import
      // analysis, so it never vouches for its imports. The moment ONE file in
      // those packages is edited (new content hash -> cache miss) while its
      // importer is still cached, vite is asked to load a file nothing
      // vouched for, skips the read, and reports the very confusing
      // `Cannot find module '/@fs/.../cards.ts'` — for a file that plainly
      // exists.
      //
      // Allowing the repo root states the intent directly instead of relying
      // on transform order. Derived from `__dirname` so it holds in a plain
      // clone, in a git worktree, and in CI.
      allow: [join(__dirname, "..")],
    },
  },
  resolve: {
    alias: {
      "~/": join(__dirname, "./src/"),
      "@ee/": join(__dirname, "./ee/"),
      "@app/": join(__dirname, "./src/server/app-layer/"),
    },
    // ONE zod instance for the app AND linked workspace packages
    // (@langwatch/langy): zod v3 instanceof-checks its own classes (e.g.
    // z.record's key/value overload detection), so a second physical copy
    // resolved from a package's own node_modules silently mis-parses.
    dedupe: ["zod"],
  },
});
