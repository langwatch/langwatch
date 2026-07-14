/**
 * @vitest-environment node
 *
 * Regression test for the trigger-dispatch outage.
 *
 * The composition root (`presets.ts`) built the EventSourcing runtime BEFORE
 * the outbox and passed the outbox to the pipeline registry (which never read
 * it) instead of to `new EventSourcing({...})`. Result: on every worker,
 * `EventSourcing._outbox` was undefined, so all four `.withOutbox` trigger
 * reactors were adapted onto the silent drop path — each logging
 * "...registered without an outbox runtime..." at registration and dropping
 * every dispatch at runtime. No trigger automation fired.
 *
 * This test boots the REAL composition through `initializeDefaultApp` (not
 * `createTestApp`, which injects null deps and bypasses the es↔outbox wiring —
 * exactly why the bug shipped uncaught) and asserts the symptom: a WORKER app
 * registers its outbox reactors WITH a runtime (zero drop-warnings), while a
 * WEB app has none (drop-warnings expected — web has no consumer to drain).
 * Before the fix, the worker assertion fails.
 *
 * Boot may throw partway through trace-pipeline registration because the test
 * sandbox cannot resolve the lazy `require("~/server/db")` alias inside
 * RecordSpanCommand. That is tolerated: the outbox reactors register earlier,
 * so the wiring symptom is already observable when the throw happens.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Funnel every module's logger into one warn spy so we can see the
// outbox-reactor-adapter's registration warning, which fires synchronously
// while `initializeDefaultApp` wires the pipelines.
const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock("~/utils/logger/server", () => {
  const make = () => {
    const logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: warnSpy,
      error: vi.fn(),
      fatal: vi.fn(),
      child: () => logger,
    };
    return logger;
  };
  return { createLogger: make };
});

import { resetApp } from "~/server/app-layer/app";
import type { App } from "~/server/app-layer/app";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import type { ProcessRole } from "~/server/app-layer/config";

const REGISTER_DROP_WARNING = "registered without an outbox runtime";

function outboxDropWarnings(): number {
  return warnSpy.mock.calls.filter((args) =>
    args.some(
      (arg) => typeof arg === "string" && arg.includes(REGISTER_DROP_WARNING),
    ),
  ).length;
}

/** Boot the composition, tolerating a sandbox-only `require("~/server/db")`
 *  resolution failure deep in trace-pipeline registration — the outbox
 *  reactors have already registered by then, which is all this test observes. */
function bootTolerant(processRole: ProcessRole): App | undefined {
  try {
    return initializeDefaultApp({ processRole });
  } catch {
    return undefined;
  }
}

describe("presets outbox wiring", () => {
  afterEach(async () => {
    await resetApp();
    vi.clearAllMocks();
  });

  describe("when the app is initialized as a worker", () => {
    it("registers outbox reactors WITH a runtime (no drop-warnings)", async () => {
      await resetApp();
      vi.clearAllMocks();

      const app = bootTolerant("worker");

      // The exact regression: without the fix these reactors register onto the
      // silent drop path and this count is non-zero.
      expect(outboxDropWarnings()).toBe(0);
      // When the boot completes (sandbox permitting), assert the invariant
      // directly too.
      if (app?.eventSourcing) {
        expect(app.eventSourcing.isOutboxWired).toBe(true);
      }
    });
  });

  describe("when the app is initialized as all (in-process dev mode)", () => {
    /** @scenario the in-process app wires the outbox exactly like a dedicated worker */
    it("wires the outbox exactly like a worker (no drop-warnings)", async () => {
      await resetApp();
      vi.clearAllMocks();

      const app = bootTolerant("all");

      // The dev single-process role hosts the worker stack in the web process,
      // so its outbox reactors must register WITH a runtime — same as "worker",
      // never on the drop path.
      expect(outboxDropWarnings()).toBe(0);
      if (app?.eventSourcing) {
        expect(app.eventSourcing.isOutboxWired).toBe(true);
      }
    });
  });

  describe("when the app is initialized as web", () => {
    it("has no outbox runtime, so its outbox reactors register on the drop path", async () => {
      await resetApp();
      vi.clearAllMocks();

      const app = bootTolerant("web");

      // Web correctly has no outbox (no consumer to drain), so the drop-path
      // registration warning is expected here — this is the control that
      // proves the worker assertion above is meaningful.
      expect(outboxDropWarnings()).toBeGreaterThan(0);
      if (app?.eventSourcing) {
        expect(app.eventSourcing.isOutboxWired).toBe(false);
      }
    });
  });
});
