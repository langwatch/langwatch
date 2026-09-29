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
  /** Per connection id, the project of each active automation using it. */
  dependents = new Map<string, string[]>();
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

  async findAllByFingerprint({
    organizationId,
    secretFingerprint,
    scopes,
  }: {
    organizationId: string;
    secretFingerprint: string;
    scopes: Pick<SlackConnectionRecord, "scopeType" | "scopeId">[];
  }) {
    return [...this.rows.values()].filter(
      (row) =>
        row.organizationId === organizationId &&
        row.secretFingerprint === secretFingerprint &&
        scopes.some(
          (scope) =>
            scope.scopeType === row.scopeType && scope.scopeId === row.scopeId,
        ),
    );
  }

  /** The unique index: one fingerprint per (organization, scope). */
  private collides(candidate: SlackConnectionRecord & { id?: string }) {
    return [...this.rows.values()].some(
      (row) =>
        row.id !== candidate.id &&
        row.organizationId === candidate.organizationId &&
        row.scopeType === candidate.scopeType &&
        row.scopeId === candidate.scopeId &&
        row.secretFingerprint === candidate.secretFingerprint,
    );
  }

  async create({
    record,
    actorId,
  }: {
    record: SlackConnectionRecord;
    actorId: string;
  }) {
    if (this.collides(record)) return null;
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
    if (this.collides(updated)) return null;
    this.rows.set(id, updated);
    return updated;
  }

  async delete({ id }: { id: string; organizationId: string }) {
    this.rows.delete(id);
  }

  async countDependentAutomations({
    ids,
    exceptProjectId,
  }: {
    organizationId: string;
    ids: string[];
    exceptProjectId?: string;
  }) {
    const counts = new Map<string, number>();
    for (const id of ids) {
      const projects = (this.dependents.get(id) ?? []).filter(
        (projectId) => projectId !== exceptProjectId,
      );
      if (projects.length > 0) counts.set(id, projects.length);
    }
    return counts;
  }
}
