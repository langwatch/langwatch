import type {
	WebhookDeliveryInput,
	WebhookDeliveryRow,
} from "@langwatch/automation-contract";

export abstract class WebhookDeliveryRepository {
	abstract create(input: WebhookDeliveryInput): Promise<void>;
	abstract findAllRecentByTriggerId(input: {
		projectId: string;
		triggerId: string;
		limit: number;
	}): Promise<WebhookDeliveryRow[]>;
	abstract pruneExpired(now?: Date): Promise<number>;
}
