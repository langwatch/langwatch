/**
 * The maintenance sweeps are REGISTERED, not merely defined.
 *
 * This exists because of the exact failure it guards: the Langy session-key
 * reaper was written, unit-tested and routed for cron — and never invoked,
 * because the chart ships no CronJobs. Every test passed while the backstop it
 * provides did not run at all. A pipeline's own unit tests say nothing about
 * whether anything mounts it, so without this, deleting the `register(...)`
 * call reintroduces that regression silently.
 *
 * `registerAll` needs a deps surface far too large to build honestly here, so
 * the stub auto-vivifies: any property is a callable that returns another such
 * proxy. That is enough to reach the maintenance registrations, which sit early
 * in the method; the run is expected to throw further down, and the assertions
 * are on what was registered BEFORE it did.
 */
import { describe, expect, it, vi } from "vitest";

import { PipelineRegistry } from "../pipelineRegistry";

/** A permissive stand-in: every access yields something callable and chainable. */
function autoStub(): any {
  const fn = () => autoStub();
  return new Proxy(fn, {
    get: (_t, prop) => {
      if (prop === "then") return undefined; // never look thenable to `await`
      if (prop === Symbol.toPrimitive) return () => "stub";
      return autoStub();
    },
    apply: () => autoStub(),
  });
}

function registeredPipelineNames(): string[] {
  const register = vi.fn(
    (pipeline: { name?: string; metadata?: { name?: string } }) => {
      // `build()` puts the name on `metadata`; read both so the guard survives
      // either shape rather than silently matching nothing.
      names.push(pipeline?.metadata?.name ?? pipeline?.name ?? "<unnamed>");
      return autoStub();
    },
  );
  const names: string[] = [];

  const deps = new Proxy(
    { eventSourcing: { register } } as Record<string, unknown>,
    {
      get: (target, prop) =>
        prop in target ? (target as any)[prop] : autoStub(),
    },
  );

  try {
    new PipelineRegistry(deps as never).registerAll();
  } catch {
    // Expected: the stub cannot satisfy every dependency to the end of the
    // method. What matters is which pipelines were registered before that.
  }
  return names;
}

describe("PipelineRegistry.registerAll", () => {
  describe("given the maintenance sweeps that nothing else would invoke", () => {
    describe("when the registry wires up its pipelines", () => {
      it("mounts the Langy session-key reaper", () => {
        expect(registeredPipelineNames()).toContain("langy_maintenance");
      });

      it("mounts the blob-maintenance sweep alongside it", () => {
        // Same class of defect, same guard: a scheduled sweep with no caller
        // is indistinguishable from a working one until the thing it protects
        // against actually happens.
        expect(registeredPipelineNames()).toContain("blob_maintenance");
      });

      /**
       * The GitHub branch recheck moved off a per-replica `setTimeout` and onto
       * this schedule. If the registration is ever dropped, the sweep stops
       * running entirely and nothing else notices: pull requests opened after a
       * session goes quiet simply never get linked, which looks like a mapping
       * bug rather than a missing caller.
       *
       * @scenario "The recheck sweep runs once per fleet, not once per replica"
       */
      it("mounts the GitHub branch recheck and retention sweep", () => {
        expect(registeredPipelineNames()).toContain("github_maintenance");
      });

      /**
       * The usage-attribution offboarding backstop (ADR-094 Decision 4). Every
       * offboarding path writes its closing rows transactionally, so this sweep
       * normally finds nothing — which is exactly why a dropped registration
       * would stay invisible until a cost report attributed somebody's spend to
       * a person who left months ago.
       */
      it("mounts the orphan usage-attribution link sweep", () => {
        expect(registeredPipelineNames()).toContain(
          "identity_links_maintenance",
        );
      });
    });
  });
});
