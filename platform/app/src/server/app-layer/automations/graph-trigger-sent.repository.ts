import { Prisma, type PrismaClient } from "~/generated/prisma/client";

export interface OpenGraphTriggerSent {
	id: string;
	triggerId: string;
	projectId: string;
	customGraphId: string;
}

export function graphAlertIncidentKey({ triggerId }: { triggerId: string }): string {
	return `graph-alert:${triggerId}`;
}

export interface GraphTriggerSentRepository {
	findOpenForGraphAlert(params: {
		triggerId: string;
		projectId: string;
		customGraphId: string;
	}): Promise<OpenGraphTriggerSent | null>;
	findLatestForGraphAlert(params: {
		triggerId: string;
		projectId: string;
		customGraphId: string;
	}): Promise<{ id: string } | null>;
	claimOpenForGraphAlert(params: {
		triggerId: string;
		projectId: string;
		customGraphId: string;
	}): Promise<OpenGraphTriggerSent | null>;
	deleteOpenClaim(params: { id: string; projectId: string }): Promise<void>;
	markResolvedById(params: {
		id: string;
		projectId: string;
		now: Date;
	}): Promise<void>;
}

/** Narrow app-only persistence adapter for graph-alert incident state. */
export class PrismaGraphTriggerSentRepository
	implements GraphTriggerSentRepository
{
	constructor(private readonly prisma: PrismaClient) {}

	async findOpenForGraphAlert({
		triggerId,
		projectId,
		customGraphId,
	}: {
		triggerId: string;
		projectId: string;
		customGraphId: string;
	}): Promise<OpenGraphTriggerSent | null> {
		const row = await this.prisma.triggerSent.findFirst({
			where: { triggerId, projectId, customGraphId, resolvedAt: null },
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				triggerId: true,
				projectId: true,
				customGraphId: true,
			},
		});
		if (!row || row.customGraphId == null) return null;
		return {
			id: row.id,
			triggerId: row.triggerId,
			projectId: row.projectId,
			customGraphId: row.customGraphId,
		};
	}

	async findLatestForGraphAlert({
		triggerId,
		projectId,
		customGraphId,
	}: {
		triggerId: string;
		projectId: string;
		customGraphId: string;
	}): Promise<{ id: string } | null> {
		const row = await this.prisma.triggerSent.findFirst({
			where: { triggerId, projectId, customGraphId },
			orderBy: { createdAt: "desc" },
			select: { id: true },
		});
		return row;
	}

	async claimOpenForGraphAlert({
		triggerId,
		projectId,
		customGraphId,
	}: {
		triggerId: string;
		projectId: string;
		customGraphId: string;
	}): Promise<OpenGraphTriggerSent | null> {
		try {
			const row = await this.prisma.triggerSent.create({
				data: {
					triggerId,
					traceId: null,
					customGraphId,
					projectId,
					resolvedAt: null,
					openIncidentKey: graphAlertIncidentKey({ triggerId }),
				},
				select: {
					id: true,
					triggerId: true,
					projectId: true,
					customGraphId: true,
				},
			});
			return row.customGraphId == null
				? null
				: {
						id: row.id,
						triggerId: row.triggerId,
						projectId: row.projectId,
						customGraphId: row.customGraphId,
				  };
		} catch (error) {
			if (
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2002"
			) {
				return null;
			}
			throw error;
		}
	}

	deleteOpenClaim({
		id,
		projectId,
	}: {
		id: string;
		projectId: string;
	}): Promise<void> {
		return this.prisma.triggerSent
			.delete({ where: { id, projectId } })
			.then(() => undefined);
	}

	async markResolvedById({
		id,
		projectId,
		now,
	}: {
		id: string;
		projectId: string;
		now: Date;
	}): Promise<void> {
		await this.prisma.triggerSent.update({
			where: { id, projectId },
			data: { resolvedAt: now, openIncidentKey: null },
		});
	}
}
