import type { Automation, EmailSuppression } from "./automation";
import type { TriggerFire } from "./trigger.queries";
export type AutomationFireStats = {
	triggerId: string;
	lastFiredAt: Date | null;
	recentFireCount: number;
};
export type AutomationServiceQueries = {
	getById(input: { id: string; projectId: string }): Promise<Automation>;
	getAll(input: { projectId: string }): Promise<Automation[]>;
	getFireStats(input: { projectId: string }): Promise<AutomationFireStats[]>;
	getRecentFires(input: {
		projectId: string;
		triggerId?: string;
		limit: number;
	}): Promise<TriggerFire[]>;
	getSuppressions(input: { projectId: string }): Promise<EmailSuppression[]>;
};
