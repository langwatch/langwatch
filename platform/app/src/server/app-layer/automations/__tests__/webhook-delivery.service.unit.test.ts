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
    pruneExpired: vi.fn(async () => 0),
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
        responseStatus: 200,
        latencyMs: 42,
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
    it("delegates retention to the repository's shared sweep", async () => {
      const pruneExpired = vi.fn(async () => 7);
      const repo = makeRepo({ pruneExpired });
      const deleted = await new WebhookDeliveryService(repo).pruneExpired();
      expect(deleted).toBe(7);
      expect(pruneExpired).toHaveBeenCalledTimes(1);
    });
  });
});
