import { describe, expect, it, vi } from "vitest";
import type {
	WebhookDeliveryInput,
	WebhookDeliveryRow,
} from "@langwatch/automation-contract";
import { WebhookDeliveryRepository } from "../src/repositories/webhook-delivery.repository";
import { WebhookDeliveryService } from "../src/services/webhook-delivery.service";

class FakeWebhookDeliveryRepository extends WebhookDeliveryRepository {
	create = vi.fn(async (_input: WebhookDeliveryInput) => undefined);
	findAllRecentByTriggerId = vi.fn(
		async () => [] as WebhookDeliveryRow[],
	);
	pruneExpired = vi.fn(async () => 0);
}

describe("WebhookDeliveryService", () => {
	it("records an attempt", async () => {
		const repository = new FakeWebhookDeliveryRepository();
		const row: WebhookDeliveryInput = {
			projectId: "p1",
			triggerId: "t1",
			dispatchId: "evt_1",
			responseStatus: 200,
			latencyMs: 42,
			outcome: "success",
		};
		await WebhookDeliveryService.create(repository).record(row);
		expect(repository.create).toHaveBeenCalledWith(row);
	});

	it("reads recent attempts with the requested scope", async () => {
		const repository = new FakeWebhookDeliveryRepository();
		await WebhookDeliveryService.create(repository).getRecentByTrigger({
			projectId: "p1",
			triggerId: "t1",
			limit: 25,
		});
		expect(repository.findAllRecentByTriggerId).toHaveBeenCalledWith({
			projectId: "p1",
			triggerId: "t1",
			limit: 25,
		});
	});

	it("delegates retention pruning", async () => {
		const repository = new FakeWebhookDeliveryRepository();
		repository.pruneExpired.mockResolvedValue(7);
		await expect(
			WebhookDeliveryService.create(repository).pruneExpired(),
		).resolves.toBe(7);
	});
});
