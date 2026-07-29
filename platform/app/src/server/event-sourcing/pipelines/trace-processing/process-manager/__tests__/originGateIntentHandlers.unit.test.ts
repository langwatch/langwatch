import { describe, expect, it, type Mock, vi } from "vitest";

import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import type { ResolveOriginCommandData } from "../../schemas/commands";
import {
  createOriginGateResolveHandler,
  type OriginGateDispatchDeps,
} from "../originGateIntentHandlers";
import type { OriginGateResolveIntent } from "../originGateProcess.types";

const CTX: IntentContext = {
  processName: "originGate",
  projectId: "project-1",
  processKey: "trace-1",
  tenantId: "project-1",
  messageKey: "process:trace-1:resolve-origin:trace-1",
  attempt: 1,
};

const INTENT: OriginGateResolveIntent = {
  tenantId: "project-1",
  traceId: "trace-1",
};

type ResolveOrigin = OriginGateDispatchDeps["resolveOrigin"];

/**
 * Typed so `resolveOrigin` stays a `Mock` through the spread — a
 * `Partial<OriginGateDispatchDeps>` override widens it back to the bare
 * function type and `.mock.calls` stops type-checking.
 */
function makeDeps(
  overrides: { resolveOrigin?: Mock<ResolveOrigin> } = {},
): OriginGateDispatchDeps & { resolveOrigin: Mock<ResolveOrigin> } {
  return {
    resolveOrigin: vi.fn<ResolveOrigin>(async () => undefined),
    ...overrides,
  };
}

describe("originGate resolveOrigin intent", () => {
  describe("when the grace period has elapsed", () => {
    /** @scenario 'Deferred check treats still-empty origin as "application"' */
    it("attributes the trace to the application", async () => {
      const deps = makeDeps();

      await createOriginGateResolveHandler(deps)(INTENT, CTX);

      expect(deps.resolveOrigin).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project-1",
          traceId: "trace-1",
          origin: "application",
          reason: "deferred_fallback",
        }),
      );
    });

    it("stamps the instant the fallback was written", async () => {
      const deps = makeDeps();
      const before = Date.now();

      await createOriginGateResolveHandler(deps)(INTENT, CTX);

      const [data] = deps.resolveOrigin.mock.calls[0] as [
        ResolveOriginCommandData,
      ];
      expect(data.occurredAt).toBeGreaterThanOrEqual(before);
      expect(data.occurredAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("when the dispatch fails", () => {
    it("throws so the outbox retries it", async () => {
      const deps = makeDeps({
        resolveOrigin: vi.fn<ResolveOrigin>(async () => {
          throw new Error("queue down");
        }),
      });

      // Swallowing here would leave the trace with no origin at all, which is
      // the gap this process exists to close. The command is idempotent per
      // (tenant, trace), so the retry cannot produce a second origin.
      await expect(
        createOriginGateResolveHandler(deps)(INTENT, CTX),
      ).rejects.toThrow("queue down");
    });
  });

  describe("when the same intent is delivered twice", () => {
    it("asks for the same origin both times", async () => {
      const deps = makeDeps();
      const handler = createOriginGateResolveHandler(deps);

      await handler(INTENT, CTX);
      await handler(INTENT, { ...CTX, attempt: 2 });

      const [first] = deps.resolveOrigin.mock.calls[0] as [
        ResolveOriginCommandData,
      ];
      const [second] = deps.resolveOrigin.mock.calls[1] as [
        ResolveOriginCommandData,
      ];
      expect({ ...first, occurredAt: 0 }).toEqual({ ...second, occurredAt: 0 });
    });
  });
});
