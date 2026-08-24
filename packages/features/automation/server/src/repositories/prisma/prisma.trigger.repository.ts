import {
	TriggerNotFoundError,
	type CreateTriggerCommand,
	type Trigger,
	type TriggerSummary,
	type UpdateTriggerCommand,
} from "@langwatch/automation-contract";
import type { AutomationDatabase } from "../../ports/automation-database.port";
import {
	TriggerRepository,
	type ReportScheduleTarget,
} from "../trigger.repository";
import { mapTriggerRow } from "./prisma.trigger.mapper";
import type { AutomationClock } from "../../ports/automation-clock.port";
export class PrismaTriggerRepository extends TriggerRepository {
	private constructor(
		private readonly database: AutomationDatabase,
		private readonly clock: AutomationClock,
	) {
		super();
	}
	static create(
		database: AutomationDatabase,
		clock: AutomationClock,
	): PrismaTriggerRepository {
		return new PrismaTriggerRepository(database, clock);
	}
	async findActiveForProject(projectId: string): Promise<TriggerSummary[]> {
		const rows = await this.database.trigger.findMany({
			where: { projectId, active: true, deleted: false },
		});
		return rows.map((row) => mapTriggerRow(row));
	}
	async findActiveReportTargets(): Promise<ReportScheduleTarget[]> {
		const rows = await this.database.trigger.findActiveReportTargets();
		return rows as ReportScheduleTarget[];
	}
	async claimSend(input: {
		triggerId: string;
		traceId: string;
		projectId: string;
	}): Promise<boolean> {
		const result = await this.database.triggerSent.createMany({
			data: [input],
			skipDuplicates: true,
		});
		return result.count === 1;
	}
	async isSendClaimed(input: {
		triggerId: string;
		traceId: string;
		projectId: string;
	}): Promise<boolean> {
		return (
			(await this.database.triggerSent.findFirst({
				where: input,
				select: { id: true },
			})) !== null
		);
	}
	async findClaimedTraceIds(input: {
		triggerId: string;
		traceIds: string[];
		projectId: string;
	}): Promise<Set<string>> {
		if (input.traceIds.length === 0) return new Set();
		const rows = await this.database.triggerSent.findMany({
			where: {
				triggerId: input.triggerId,
				projectId: input.projectId,
				traceId: { in: input.traceIds },
			},
			select: { traceId: true },
		});
		return new Set(
			rows.flatMap((row) => {
				const id = (row as { traceId?: unknown }).traceId;
				return typeof id === "string" ? [id] : [];
			}),
		);
	}
	async updateLastRunAt(input: {
		triggerId: string;
		projectId: string;
	}): Promise<void> {
		await this.database.trigger.update({
			where: { id: input.triggerId, projectId: input.projectId },
			data: { lastRunAt: this.clock.now().getTime() },
		});
	}
	async findByIdOrThrow(input: {
		triggerId: string;
		projectId: string;
	}): Promise<Trigger> {
		const row = await this.database.trigger.findFirst({
			where: { id: input.triggerId, projectId: input.projectId },
		});
		if (row === null) throw new TriggerNotFoundError();
		return mapTriggerRow(row);
	}
	async tryFindById(input: {
		triggerId: string;
		projectId: string;
	}): Promise<Trigger | null> {
		const row = await this.database.trigger.findFirst({
			where: { id: input.triggerId, projectId: input.projectId },
		});
		return row === null ? null : mapTriggerRow(row);
	}
	async findAllByProjectId(input: { projectId: string }): Promise<Trigger[]> {
		const rows = await this.database.trigger.findMany({
			where: { projectId: input.projectId, deleted: false },
			orderBy: { createdAt: "desc" },
		});
		return rows.map((row) => mapTriggerRow(row));
	}
	async tryFindByCustomGraphId(input: {
		projectId: string;
		customGraphId: string;
	}): Promise<Trigger | null> {
		const row = await this.database.trigger.findFirst({
			where: { projectId: input.projectId, customGraphId: input.customGraphId },
		});
		return row === null ? null : mapTriggerRow(row);
	}
	async create(input: CreateTriggerCommand): Promise<Trigger> {
		const row = await this.database.trigger.create({
			data: {
				...(input.id ? { id: input.id } : {}),
				...input,
				lastRunAt: input.lastRunAt?.getTime() ?? this.clock.now().getTime(),
				triggerKind: input.triggerKind ?? "AUTOMATION",
				filters: input.filters ?? {},
				filterQuery: input.filterQuery ?? null,
				message: input.message ?? null,
				alertType: input.alertType ?? null,
				customGraphId: input.customGraphId ?? null,
			},
		});
		return mapTriggerRow(row);
	}
	async update(input: UpdateTriggerCommand): Promise<Trigger> {
		const { id, projectId, lastRunAt, ...data } = input;
		const row = await this.database.trigger.update({
			where: { id, projectId },
			data: {
				...data,
				...(lastRunAt !== undefined
					? { lastRunAt: lastRunAt === null ? 0 : lastRunAt.getTime() }
					: {}),
			},
		});
		return mapTriggerRow(row);
	}
}
