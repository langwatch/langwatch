import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";

import { createAgentListingPort } from "../agentListingPort";

const syncFromSource = vi.fn();

vi.mock("../../agentDiscovery.service", () => ({
  AgentDiscoveryService: {
    create: () => ({ syncFromSource }),
  },
}));

function prismaWith(source: { organizationId: string } | null): PrismaClient {
  return {
    ingestionSource: { findUnique: vi.fn().mockResolvedValue(source) },
  } as unknown as PrismaClient;
}

const NOW = new Date("2026-09-09T10:00:00Z");

beforeEach(() => {
  syncFromSource.mockReset();
});

describe("agent listing port", () => {
  describe("when the source exists", () => {
    it("resolves the organization from the source rather than the intent", async () => {
      syncFromSource.mockResolvedValue({ outcome: "listed", recorded: 3 });
      const port = createAgentListingPort({
        prisma: prismaWith({ organizationId: "org-1" }),
        clock: () => NOW,
      });

      await port.list({ sourceId: "source-1" });

      expect(syncFromSource).toHaveBeenCalledWith({
        organizationId: "org-1",
        ingestionSourceId: "source-1",
        now: NOW,
      });
    });

    it("passes the injected clock through as the sighting instant", async () => {
      syncFromSource.mockResolvedValue({ outcome: "listed", recorded: 1 });
      const port = createAgentListingPort({
        prisma: prismaWith({ organizationId: "org-1" }),
        clock: () => NOW,
      });

      await port.list({ sourceId: "source-1" });

      expect(syncFromSource.mock.calls[0]?.[0].now).toBe(NOW);
    });
  });

  describe("when the listing recorded agents", () => {
    it("reports the recorded count", async () => {
      syncFromSource.mockResolvedValue({ outcome: "listed", recorded: 3 });
      const port = createAgentListingPort({
        prisma: prismaWith({ organizationId: "org-1" }),
        clock: () => NOW,
      });

      await expect(port.list({ sourceId: "source-1" })).resolves.toEqual({
        outcome: "listed",
        agentCount: 3,
      });
    });
  });

  describe("when the provider named no agents", () => {
    it("flattens to a zero count on the listed arm, never to a refusal", async () => {
      syncFromSource.mockResolvedValue({ outcome: "empty" });
      const port = createAgentListingPort({
        prisma: prismaWith({ organizationId: "org-1" }),
        clock: () => NOW,
      });

      await expect(port.list({ sourceId: "source-1" })).resolves.toEqual({
        outcome: "listed",
        agentCount: 0,
      });
    });
  });

  describe("when the provider refused", () => {
    it("carries the reason and status straight through", async () => {
      syncFromSource.mockResolvedValue({
        outcome: "refused",
        refusal: { reason: "rate_limited", status: 429 },
      });
      const port = createAgentListingPort({
        prisma: prismaWith({ organizationId: "org-1" }),
        clock: () => NOW,
      });

      await expect(port.list({ sourceId: "source-1" })).resolves.toEqual({
        outcome: "refused",
        reason: "rate_limited",
        status: 429,
      });
    });
  });

  describe("when the source no longer exists", () => {
    it("refuses rather than throwing, so the outbox does not retry", async () => {
      const port = createAgentListingPort({
        prisma: prismaWith(null),
        clock: () => NOW,
      });

      await expect(port.list({ sourceId: "gone" })).resolves.toEqual({
        outcome: "refused",
        reason: "not_found",
        status: null,
      });
      expect(syncFromSource).not.toHaveBeenCalled();
    });
  });
});
