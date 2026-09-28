import type { SlackIntegration } from "~/generated/prisma/client";
import type {
  SlackConnectionChanges,
  SlackConnectionRecord,
  SlackIntegrationRepository,
  SlackProjectScope,
} from "../repositories/slack-integration.repository";

/** Two projects of one organization, the fixture every fake read resolves. */
export const PROJECTS: Record<string, SlackProjectScope> = {
  "project-1": {
    projectId: "project-1",
    projectName: "Checkout",
    organizationId: "org-1",
    organizationName: "Acme",
  },
  "project-2": {
    projectId: "project-2",
    projectName: "Search",
    organizationId: "org-1",
    organizationName: "Acme",
  },
};

/** In-memory stand-in for the table, so tests read what was actually stored. */
export class FakeSlackIntegrationRepository
  implements SlackIntegrationRepository
{
  rows = new Map<string, SlackIntegration>();
  dependents = new Map<string, number>();
  private next = 1;

  async findProjectScope({ projectId }: { projectId: string }) {
    return PROJECTS[projectId] ?? null;
  }

  async findById({ id }: { id: string }) {
    return this.rows.get(id) ?? null;
  }

  async findAllUsableByProject({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    projectId: string;
  }) {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          (row.scopeType === "ORGANIZATION" || row.scopeId === projectId),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async findByFingerprint({
    organizationId,
    secretFingerprint,
  }: {
    organizationId: string;
    secretFingerprint: string;
  }) {
    return (
      [...this.rows.values()].find(
        (row) =>
          row.organizationId === organizationId &&
          row.secretFingerprint === secretFingerprint,
      ) ?? null
    );
  }

  async create({
    record,
    actorId,
  }: {
    record: SlackConnectionRecord;
    actorId: string;
  }) {
    const row: SlackIntegration = {
      ...record,
      id: `conn-${this.next++}`,
      createdById: actorId,
      updatedById: actorId,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    this.rows.set(row.id, row);
    return row;
  }

  async update({
    id,
    changes,
    actorId,
  }: {
    id: string;
    organizationId: string;
    changes: SlackConnectionChanges;
    actorId: string;
  }) {
    const row = this.rows.get(id);
    if (!row) return null;
    const updated = { ...row, ...changes, updatedById: actorId };
    this.rows.set(id, updated);
    return updated;
  }

  async delete({ id }: { id: string; organizationId: string }) {
    this.rows.delete(id);
  }

  async countDependentAutomations({
    ids,
  }: {
    organizationId: string;
    ids: string[];
  }) {
    return new Map(
      ids.flatMap((id) => {
        const count = this.dependents.get(id);
        return count === undefined ? [] : [[id, count] as const];
      }),
    );
  }
}
