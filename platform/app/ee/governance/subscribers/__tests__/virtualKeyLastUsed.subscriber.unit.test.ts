/**
 * Unit tests for the ADR-075 Class C (retired; ground now ADR-098) split:
 * the half of `gatewayBudgetSync` that is a best-effort Prisma side effect
 * rather than derived state. Now a pre-built `BuiltSubscriber` (ADR-107
 * decision 17), mounted behind `deps.ee` on trace-processing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalSpan } from "~/server/event-sourcing/trace-processing/__tests__/fixtures";
import {
  createVirtualKeyLastUsedSubscriber,
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

const CTX = { now: Date.now(), tenantId: "project-1" };
const TENANT_ORG = "org-1";

function gatewayEvent(attributes: Record<string, unknown> = {}) {
  return {
    type: "lw.obs.trace.span_received",
    data: canonicalSpan({
      attributes: { "langwatch.virtual_key_id": "vk-1", ...attributes },
    }),
  };
}

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

describe("virtualKeyLastUsed subscriber", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listens only to span_received", () => {
    const { subscriber } = buildSubscriber(null);
    expect(subscriber.eventTypes).toEqual(["lw.obs.trace.span_received"]);
  });

  describe("given a key that has never been used", () => {
    it("stamps it as used now", async () => {
      const { subscriber, update } = buildSubscriber({
        id: "vk-1",
        lastUsedAt: null,
      });

      await subscriber.handle(gatewayEvent(), CTX);

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

      await subscriber.handle(gatewayEvent(), CTX);

      expect(update).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a span naming a virtual key from another organization", () => {
    it("refuses the write rather than trusting the span's key id", async () => {
      const { subscriber, update } = buildSubscriber(
        { id: "vk-1", lastUsedAt: null, organizationId: "org-victim" },
        { projectOrganizationId: "org-attacker" },
      );

      await subscriber.handle(gatewayEvent(), CTX);

      expect(update).not.toHaveBeenCalled();
    });

    it("refuses the write when the tenant project cannot be resolved", async () => {
      const { subscriber, update } = buildSubscriber(
        { id: "vk-1", lastUsedAt: null },
        { projectOrganizationId: null },
      );

      await subscriber.handle(gatewayEvent(), CTX);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("given a key used within the throttle window", () => {
    it("leaves the row alone rather than thrashing it per request", async () => {
      const { subscriber, update } = buildSubscriber({
        id: "vk-1",
        lastUsedAt: new Date(),
      });

      await subscriber.handle(gatewayEvent(), CTX);

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("given a span with no virtual key marker", () => {
    it("does not read the key table at all", async () => {
      const { subscriber, prisma } = buildSubscriber({
        id: "vk-1",
        lastUsedAt: null,
      });

      await subscriber.handle(
        {
          type: "lw.obs.trace.span_received",
          data: canonicalSpan({ attributes: {} }),
        },
        CTX,
      );

      expect(prisma.virtualKey.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("given the key no longer exists", () => {
    it("does nothing", async () => {
      const { subscriber, update } = buildSubscriber(null);

      await subscriber.handle(gatewayEvent(), CTX);

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
        subscriber.handle(gatewayEvent(), CTX),
      ).resolves.toBeUndefined();
    });
  });
});
