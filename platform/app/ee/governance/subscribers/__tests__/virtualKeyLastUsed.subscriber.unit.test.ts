/**
 * Unit tests for the ADR-075 Class C (retired; ground now ADR-098) split:
 * the half of `gatewayBudgetSync` that is a best-effort Prisma side effect
 * rather than derived state.
 *
 * Two things are load-bearing. The enqueue filter has to be TOTAL — ADR-069
 * (retired; ground now ADR-098) gives it no retry, so a throw there
 * permanently loses the job rather than
 * reading as "not relevant". And the handler has to stay silent on failure:
 * this lane carries nothing worth wedging a queue over.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSpanReceivedEvent,
  type TestSpanReceivedEventOptions,
} from "~/server/event-sourcing.old/pipelines/trace-processing/projections/__tests__/fixtures/trace-summary-test.fixtures";
import type { TraceProcessingEvent } from "~/server/event-sourcing.old/pipelines/trace-processing/schemas/events";
import {
  createVirtualKeyLastUsedSubscriber,
  spanCarriesVirtualKeyMarker,
  VIRTUAL_KEY_LAST_USED_THROTTLE_MS,
} from "../virtualKeyLastUsed.subscriber";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

const CONTEXT = { tenantId: "project-1", aggregateId: "trace-1" };

function gatewayEvent(
  options: TestSpanReceivedEventOptions = {},
): TraceProcessingEvent {
  return createSpanReceivedEvent({
    ...options,
    attributes: {
      "langwatch.virtual_key_id": "vk-1",
      ...(options.attributes ?? {}),
    },
  }) as unknown as TraceProcessingEvent;
}

const TENANT_ORG = "org-1";

function buildSubscriber(
  vk: { id: string; lastUsedAt: Date | null; organizationId?: string } | null,
  options: { projectOrganizationId?: string | null } = {},
) {
  const update = vi.fn().mockResolvedValue({});
  const projectOrg =
    options.projectOrganizationId === undefined
      ? TENANT_ORG
      : options.projectOrganizationId;
  const prisma = {
    virtualKey: {
      findUnique: vi
        .fn()
        .mockResolvedValue(vk ? { organizationId: TENANT_ORG, ...vk } : null),
      update,
    },
    project: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          projectOrg === null ? null : { team: { organizationId: projectOrg } },
        ),
    },
  };
  return {
    subscriber: createVirtualKeyLastUsedSubscriber({ prisma: prisma as never }),
    prisma,
    update,
  };
}

describe("spanCarriesVirtualKeyMarker", () => {
  describe("given a gateway span", () => {
    it("accepts it", () => {
      expect(spanCarriesVirtualKeyMarker(gatewayEvent())).toBe(true);
    });
  });

  describe("given an ordinary application span", () => {
    it("declines it, so the vast majority of the span stream mints no job", () => {
      const event = createSpanReceivedEvent({
        attributes: { "gen_ai.request.model": "gpt-5-mini" },
      }) as unknown as TraceProcessingEvent;
      expect(spanCarriesVirtualKeyMarker(event)).toBe(false);
    });
  });

  describe("given an event of another type", () => {
    it("declines it", () => {
      expect(
        spanCarriesVirtualKeyMarker({
          type: "lw.obs.trace.origin_resolved",
        } as TraceProcessingEvent),
      ).toBe(false);
    });
  });

  describe("given a malformed payload", () => {
    it("returns false instead of throwing, because a throw would lose the job", () => {
      const malformed = [
        { type: "lw.obs.trace.span_received" },
        { type: "lw.obs.trace.span_received", data: {} },
        { type: "lw.obs.trace.span_received", data: { span: {} } },
        {
          type: "lw.obs.trace.span_received",
          data: { span: { attributes: null } },
        },
        {
          type: "lw.obs.trace.span_received",
          data: { span: { attributes: "not-an-array" } },
        },
        {
          type: "lw.obs.trace.span_received",
          data: { span: { attributes: [null, undefined, {}] } },
        },
      ] as unknown as TraceProcessingEvent[];

      for (const event of malformed) {
        expect(() => spanCarriesVirtualKeyMarker(event)).not.toThrow();
        expect(spanCarriesVirtualKeyMarker(event)).toBe(false);
      }
    });
  });
});

describe("virtualKeyLastUsed subscriber", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("given a key that has never been used", () => {
    it("stamps it as used now", async () => {
      const { subscriber, update } = buildSubscriber({
        id: "vk-1",
        lastUsedAt: null,
      });

      await subscriber.handle(gatewayEvent(), CONTEXT);

      expect(update).toHaveBeenCalledTimes(1);
      expect(update.mock.calls[0]![0]).toMatchObject({ where: { id: "vk-1" } });
    });
  });

  describe("given a key used longer ago than the throttle window", () => {
    it("stamps it again", async () => {
      const { subscriber, update } = buildSubscriber({
        id: "vk-1",
        lastUsedAt: new Date(
          Date.now() - VIRTUAL_KEY_LAST_USED_THROTTLE_MS * 2,
        ),
      });

      await subscriber.handle(gatewayEvent(), CONTEXT);

      expect(update).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a span naming a virtual key from another organization", () => {
    it("refuses the write rather than trusting the span's key id", async () => {
      // `langwatch.virtual_key_id` is customer-writable and is not in the
      // reserved namespace the receiver strips, so any tenant can name any VK
      // id. The multitenancy middleware does not catch it either — VirtualKey's
      // validateWhere accepts a bare row id as tenancy proof.
      const { subscriber, update } = buildSubscriber(
        { id: "vk-1", lastUsedAt: null, organizationId: "org-victim" },
        { projectOrganizationId: "org-attacker" },
      );

      await subscriber.handle(gatewayEvent(), CONTEXT);

      expect(update).not.toHaveBeenCalled();
    });

    it("refuses the write when the tenant project cannot be resolved", async () => {
      const { subscriber, update } = buildSubscriber(
        { id: "vk-1", lastUsedAt: null },
        { projectOrganizationId: null },
      );

      await subscriber.handle(gatewayEvent(), CONTEXT);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("given a key used within the throttle window", () => {
    it("leaves the row alone rather than thrashing it per request", async () => {
      const { subscriber, update } = buildSubscriber({
        id: "vk-1",
        lastUsedAt: new Date(),
      });

      await subscriber.handle(gatewayEvent(), CONTEXT);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("given a span with no virtual key marker", () => {
    it("does not read the key table at all", async () => {
      const { subscriber, prisma } = buildSubscriber({
        id: "vk-1",
        lastUsedAt: null,
      });
      const event = createSpanReceivedEvent({
        attributes: { "gen_ai.request.model": "gpt-5-mini" },
      }) as unknown as TraceProcessingEvent;

      await subscriber.handle(event, CONTEXT);

      expect(prisma.virtualKey.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("given the key no longer exists", () => {
    it("does nothing", async () => {
      const { subscriber, update } = buildSubscriber(null);

      await subscriber.handle(gatewayEvent(), CONTEXT);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("given the write fails", () => {
    it("never throws back into the queue", async () => {
      const { subscriber, update } = buildSubscriber({
        id: "vk-1",
        lastUsedAt: null,
      });
      update.mockRejectedValue(new Error("PG down"));

      await expect(
        subscriber.handle(gatewayEvent(), CONTEXT),
      ).resolves.toBeUndefined();
    });
  });

  describe("given the subscriber is registered", () => {
    it("declines irrelevant events at the enqueue seam", () => {
      const { subscriber } = buildSubscriber(null);
      expect(subscriber.options?.enqueue?.filter).toBe(
        spanCarriesVirtualKeyMarker,
      );
    });

    it("listens only to span_received", () => {
      const { subscriber } = buildSubscriber(null);
      expect(subscriber.eventTypes).toEqual(["lw.obs.trace.span_received"]);
    });
  });
});
