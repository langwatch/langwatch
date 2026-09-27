/**
 * @vitest-environment node
 * @unit
 * Redelivery is at-least-once: the same fold delivered twice must not repeat a CRM milestone.
 */
import type { OrgAdminResolution } from "@langwatch/project-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TraceProjectMetadata } from "../../app/trace.members.ts";
import {
  createCustomerIoTraceSyncHandler,
  resetCustomerIoTraceSyncDebounceCache,
  type CustomerIoTraceSyncSubscriberDeps,
} from "../customer-io-trace-sync.subscriber.ts";
import {
  createContext,
  createFoldState,
  createOtlpSpan,
  createSpanReceivedEvent,
} from "./trace-subscriber.fixtures.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function resolution(firstMessage: boolean): OrgAdminResolution {
  return {
    userId: "user-1",
    organizationId: "org-1",
    firstMessage,
    onboardingVariant: null,
    organizationCreatedAt: null,
  };
}

function subscriber(resolveOrgAdmin: TraceProjectMetadata["resolveOrgAdmin"]) {
  const fired: string[] = [];
  const deps = {
    projects: {
      findById: async () => null,
      updateMetadata: async () => undefined,
      resolveOrgAdmin,
    },
    traceSync: {
      fireFirstTraceIntegrated: () => {
        fired.push("first_trace_integrated");
      },
      identifySubsequentTrace: () => {
        fired.push("identify");
      },
    },
  } satisfies CustomerIoTraceSyncSubscriberDeps;
  return { handler: createCustomerIoTraceSyncHandler(deps), fired };
}

async function deliverTwice(handler: ReturnType<typeof subscriber>["handler"]) {
  const event = createSpanReceivedEvent(createOtlpSpan());
  const context = createContext(
    createFoldState({ attributes: { "langwatch.origin": "application" } }),
  );
  await handler(event, context);
  await handler(event, context);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
  resetCustomerIoTraceSyncDebounceCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("given the customer.io trace sync subscriber", () => {
  describe("when a later trace's fold is delivered twice", () => {
    it("identifies the admin once", async () => {
      const { handler, fired } = subscriber(async () => resolution(true));

      await deliverTwice(handler);

      expect(fired).toEqual(["identify"]);
    });
  });

  describe("when the project's first trace is delivered twice", () => {
    it("fires the first-trace milestone once, the flag being set by the redelivery", async () => {
      const answers = [resolution(false), resolution(true)];
      const { handler, fired } = subscriber(async () => answers.shift() ?? resolution(true));

      await deliverTwice(handler);

      expect(fired.filter((name) => name === "first_trace_integrated")).toHaveLength(1);
    });
  });
});
