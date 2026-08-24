import type {
	WebhookDeliveryInput,
	WebhookDeliveryRow,
} from "@langwatch/automation-contract";
import { WebhookDeliveryRepository } from "../repositories/webhook-delivery.repository";

export class WebhookDeliveryService {
	private constructor(private readonly repository: WebhookDeliveryRepository) {}

	static create(repository: WebhookDeliveryRepository): WebhookDeliveryService {
		return new WebhookDeliveryService(repository);
	}

	record(input: WebhookDeliveryInput): Promise<void> {
		return this.repository.create(input);
	}

	getRecentByTrigger(input: {
		projectId: string;
		triggerId: string;
		limit: number;
	}): Promise<WebhookDeliveryRow[]> {
		return this.repository.findAllRecentByTriggerId(input);
	}

	pruneExpired(now?: Date): Promise<number> {
		return this.repository.pruneExpired(now);
	}
}
