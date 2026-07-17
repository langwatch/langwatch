import { describe, expect, it, vi } from "vitest";
import type {
  WebhookDeliveryInput,
  WebhookDeliveryRepository,
  WebhookDeliveryRow,
} from "../repositories/webhook-delivery.repository";
import { WebhookDeliveryService } from "../webhook-delivery.service";

function makeRepo(overrides?: Partial<WebhookDeliveryRepository>) {
  return {
    create: vi.fn(async (_: WebhookDeliveryInput) => undefined),
    findAllRecentByTriggerId: vi.fn(async () => [] as WebhookDeliveryRow[]),
    deleteOlderThan: vi.fn(async () => 0),
    ...overrides,
  } satisfies WebhookDeliveryRepository;
}

describe("WebhookDeliveryService", () => {
  describe("record", () => {
    it("delegates the attempt to the repository", async () => {
      const repo = makeRepo();
      const row: WebhookDeliveryInput = {
        projectId: "p1",
        triggerId: "t1",
        dispatchId: "evt_1",
        requestMethod: "POST",
        requestUrl: "https://example.com/hook",
        requestHeaders: { Authorization: "***" },
        outcome: "success",
      };
      await new WebhookDeliveryService(repo).record(row);
      expect(repo.create).toHaveBeenCalledWith(row);
    });
  });

  describe("getRecentByTrigger", () => {
    it("threads projectId, triggerId, and limit to the repository", async () => {
      const repo = makeRepo();
      await new WebhookDeliveryService(repo).getRecentByTrigger({
        projectId: "p1",
        triggerId: "t1",
        limit: 25,
      });
      expect(repo.findAllRecentByTriggerId).toHaveBeenCalledWith({
        projectId: "p1",
        triggerId: "t1",
        limit: 25,
      });
    });
  });

  describe("pruneExpired", () => {
    it("deletes rows older than ~30 days", async () => {
      const repo = makeRepo({ deleteOlderThan: vi.fn(async () => 7) });
      const deleted = await new WebhookDeliveryService(repo).pruneExpired();
      expect(deleted).toBe(7);
      const before = repo.deleteOlderThan.mock.calls[0]![0].before.getTime();
      const daysAgo = (Date.now() - before) / (24 * 60 * 60 * 1000);
      expect(daysAgo).toBeGreaterThan(29.9);
      expect(daysAgo).toBeLessThan(30.1);
    });
  });
});
