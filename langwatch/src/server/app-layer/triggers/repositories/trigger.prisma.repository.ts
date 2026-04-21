import type { PrismaClient } from "@prisma/client";
import type { TriggerFilters } from "~/server/filters/types";
import type {
  TriggerRepository,
  TriggerSummary,
} from "./trigger.repository";

export class PrismaTriggerRepository implements TriggerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveForProject(projectId: string): Promise<TriggerSummary[]> {
    const triggers = await this.prisma.trigger.findMany({
      where: { projectId, active: true, deleted: false },
      select: {
        id: true,
        projectId: true,
        name: true,
        action: true,
        actionParams: true,
        filters: true,
        alertType: true,
        message: true,
        customGraphId: true,
      },
    });

    return triggers.map((t) => ({
      ...t,
      actionParams: t.actionParams ?? {},
      filters: parseFilters(t.filters),
    }));
  }
}

function parseFilters(raw: unknown): TriggerFilters {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as TriggerFilters;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") {
    return raw as TriggerFilters;
  }
  return {};
}
