/**
 * The billing meter sweep is WIRED, not merely defined.
 *
 * This exists because of the exact failure it guards. The sweep was written,
 * unit-tested and documented as "the guarantee" behind the per-event poke — and
 * the composition root never passed the deps that mount it, so
 * `withProcessManager` was never reached and `billingMeterSweep` did not exist
 * at runtime. Every test passed. The only symptom would have been an
 * organization whose last billable event of the month was its last event ever,
 * silently never invoiced for that month.
 *
 * A pipeline's own unit tests say nothing about whether anything supplies its
 * deps, so this drives the registry's real billing registration rather than
 * assembling the deps here. It calls that one method directly: `registerAll`
 * reaches billing only at the very end, past a dozen pipelines whose deps a
 * stub cannot satisfy (trace-processing alone `require`s `~/server/db` at call
 * time), so booting the whole method would make this guard fail for reasons
 * that have nothing to do with billing. The deps surface is far too large to
 * build honestly, so the stub auto-vivifies — the same technique
 * `event-sourcing/__tests__/pipelineRegistration.unit.test.ts` uses, and for
 * the same reason.
 *
 * @see specs/licensing/billing-meter-dispatch.feature
 */

import { describe, expect, it, vi } from "vitest";

import { PipelineRegistry } from "../../../pipelineRegistry";
import { BILLING_REPORTING_PIPELINE_NAME } from "../pipeline";
import { BILLING_METER_SWEEP_PROCESS_NAME } from "../process-manager/billingMeterSweep.process";

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

type RegisteredDefinition = {
  metadata?: { name?: string };
  processManagers?: Map<string, unknown>;
};

function registerBilling(): RegisteredDefinition | undefined {
  let registered: RegisteredDefinition | undefined;
  const register = vi.fn((pipeline: RegisteredDefinition) => {
    registered = pipeline;
    return autoStub();
  });

  const eventSourcing = new Proxy({ register } as Record<string, unknown>, {
    get: (target, prop) =>
      prop in target ? (target as any)[prop] : autoStub(),
  });
  const deps = new Proxy({ eventSourcing } as Record<string, unknown>, {
    get: (target, prop) =>
      prop in target ? (target as any)[prop] : autoStub(),
  });

  const registry = new PipelineRegistry(deps as never) as unknown as {
    registerBillingReportingPipeline: () => unknown;
  };
  registry.registerBillingReportingPipeline();

  return registered;
}

describe("PipelineRegistry billing-reporting registration", () => {
  describe("given the scheduled sweep that is the usage-reporting guarantee", () => {
    describe("when the registry wires up the billing pipeline", () => {
      it("registers it under the billing-reporting name", () => {
        expect(registerBilling()?.metadata?.name).toBe(
          BILLING_REPORTING_PIPELINE_NAME,
        );
      });

      /** @scenario "The sweep is armed by the composition root, not merely defined" */
      it("arms the billing meter sweep on it", () => {
        const billing = registerBilling();

        // Without the candidate query the registry supplies, the pipeline
        // builds with no process manager at all — and reports usage
        // exclusively off the per-event poke.
        expect([...(billing?.processManagers?.keys() ?? [])]).toContain(
          BILLING_METER_SWEEP_PROCESS_NAME,
        );
      });
    });
  });
});
