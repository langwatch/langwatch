import type {
	AutomationFireStats,
	TriggerFire,
	TriggerFireStats,
} from "@langwatch/automation-contract";
export abstract class TriggerFireHistoryRepository {
	abstract create(input: {
		projectId: string;
		triggerId: string;
		traceId: string | null;
		customGraphId: string | null;
		createdAt: Date;
		resolvedAt: Date | null;
	}): Promise<TriggerFire>;
	abstract findAllStatsForProject(input: {
		projectId: string;
		firesSince: Date;
	}): Promise<TriggerFireStats[]>;
	abstract findAllRecentByTriggerId(input: {
		projectId: string;
		triggerId: string;
		limit: number;
	}): Promise<TriggerFire[]>;
	abstract findAllRecentForProject(input: {
		projectId: string;
		limit: number;
	}): Promise<TriggerFire[]>;
	/** Compatibility aliases used by the aggregate Automation service. */
	abstract findStats(input: {
		projectId: string;
		firesSince: Date;
	}): Promise<AutomationFireStats[]>;
	abstract findRecent(input: {
		projectId: string;
		triggerId?: string;
		limit: number;
	}): Promise<TriggerFire[]>;
}
