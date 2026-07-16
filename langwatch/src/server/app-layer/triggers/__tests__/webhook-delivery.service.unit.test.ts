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
  describe("when recording an attempt", () => {
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

  describe("when fetching recent attempts", () => {
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

  describe("when pruning expired attempts", () => {
    it("scopes the delete by projectId and cuts off at ~30 days", async () => {
      // Hold the mock in a local const: the repo prop is typed as the
      // repository function (no `.mock`), so assert on the const instead.
      const deleteOlderThan = vi.fn(
        async (_params: { projectIds: string[]; before: Date }) => 7,
      );
      const repo = makeRepo({ deleteOlderThan });
      const deleted = await new WebhookDeliveryService(repo).pruneExpired({
        projectIds: ["p1", "p2"],
      });
      expect(deleted).toBe(7);
      const call = deleteOlderThan.mock.calls[0]![0];
      expect(call.projectIds).toEqual(["p1", "p2"]);
      const daysAgo = (Date.now() - call.before.getTime()) / (24 * 60 * 60 * 1000);
      expect(daysAgo).toBeGreaterThan(29.9);
      expect(daysAgo).toBeLessThan(30.1);
    });
  });
});
