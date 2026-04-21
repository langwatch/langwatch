import type { AlertType, TriggerAction } from "@prisma/client";
import type { TriggerFilters } from "~/server/filters/types";

export interface TriggerSummary {
  id: string;
  projectId: string;
  name: string;
  action: TriggerAction;
  actionParams: unknown;
  filters: TriggerFilters;
  alertType: AlertType | null;
  message: string | null;
  customGraphId: string | null;
}

export interface TriggerRepository {
  findActiveForProject(projectId: string): Promise<TriggerSummary[]>;
}

export class NullTriggerRepository implements TriggerRepository {
  async findActiveForProject(_projectId: string): Promise<TriggerSummary[]> {
    return [];
  }
}
