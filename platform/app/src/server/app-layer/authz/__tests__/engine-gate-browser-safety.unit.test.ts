/** @vitest-environment node */

/**
 * Two halves of one rule: the engine gate must stay importable from the
 * browser, and the observability it gives up to do so must be handed back by
 * the server.
 *
 * `rbac.ts` imports the gate, and the browser imports `rbac.ts` for the
 * permission-matching functions the UI gates on (`useOrganizationTeamProject`,
 * the settings permission picker). So whatever the gate imports, the client
 * bundle gets.
 *
 * What breaks is not "a Node package" in general — it is a module that RUNS
 * something at import time. `prom-client` calls `register.removeSingleMetric`
 * as a side effect of being imported, which reaches `process`; every chunk
 * then dies on `process is not defined` and the app never mounts. That
 * happened here, and it passed typecheck, lint and the whole unit suite on the
 * way through, because none of those load a browser.
 *
 * `@langwatch/observability` is deliberately NOT on the list: the cached-flag
 * helper in this same graph constructs a logger at module scope and has done
 * on main for as long as the file has existed, with the client build green —
 * pino defers touching `process.stdout` until something actually logs.
 *
 * The gate therefore ships with a no-op failure reporter. A no-op nobody
 * replaces is the other failure — a reopened legacy-fallback window with
 * nothing said about it — so the last test pins that the composition installs
 * the real one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AUTHZ_DIR = join(import.meta.dirname, "..");

/** Modules that execute something touching `process` on import. */
const RUNS_AT_IMPORT = ["prom-client", "./metrics", "~/server/db", "ioredis"];

function importsOf(file: string): string[] {
  const source = readFileSync(join(AUTHZ_DIR, file), "utf8");
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
}

describe("the authz engine gate's browser safety", () => {
  describe("given the gate as the browser will load it", () => {
    /** @scenario "The permission vocabulary the UI reads pulls in no server code" */
    it("imports nothing that runs at import time", () => {
      expect(
        importsOf("engine-gate.ts").filter((spec) =>
          RUNS_AT_IMPORT.includes(spec),
        ),
      ).toEqual([]);
    });

    /** The cached-flag helper is in the same graph and carries the same rule. */
    it("holds the same rule for the cache it depends on", () => {
      expect(
        importsOf("../_shared/per-subject-cached-gate.ts").filter((spec) =>
          RUNS_AT_IMPORT.includes(spec),
        ),
      ).toEqual([]);
    });
  });

  describe("given the server composition", () => {
    // Supplementary wiring tripwire. What the installed reporter DOES is
    // pinned behaviourally in engine-gate-reporting.unit.test.ts; the gate's
    // side is pinned in engine-gate.unit.test.ts. What neither can see is
    // whether the composition root calls the installer at all — presets.ts is
    // too heavy to import in a unit test — and an installer defined but never
    // called is exactly as silent as none. So this checks only the call site.
    it("installs the real failure reporter rather than leaving the no-op", () => {
      const presets = readFileSync(join(AUTHZ_DIR, "..", "presets.ts"), "utf8");

      expect(presets).toContain("installAuthzEngineGateReporting()");
    });
  });
});
