/**
 * ADR-144 decision 5: only an organisation admin opens an aggregate project.
 *
 * Applied to every project-tier decision, after the grants engine has answered,
 * because an aggregate attaches to a team like any project and the engine
 * would otherwise admit everyone on that team. Being on the team must never
 * become a silent read grant over other people's personal data.
 *
 * The rule itself is `aggregateProjectRouteViolation` in the projects app
 * layer; this module only finds the project's kind and applies it.
 */
import type { PrismaClient } from "~/generated/prisma/client";
import { aggregateProjectRouteViolation } from "../projects/project-kinds";
import type { PermissionDecision } from "./permission-decision.repository";

/** How the gate learns a project's kind. */
export interface ProjectKindReader {
  kindOf(projectId: string): Promise<string | null>;
  /** Many projects' kinds in one read; an unknown id is absent. */
  kindsOf(projectIds: readonly string[]): Promise<Map<string, string>>;
}

const MAX_CACHED_KINDS = 10_000;

/**
 * Reads `Project.kind` by id. A kind is written once, at creation, and no
 * route changes it, so a remembered answer never goes stale and is safe to
 * keep per process; the bound only caps memory.
 */
export class PrismaProjectKindReader implements ProjectKindReader {
  private readonly kinds = new Map<string, string>();

  constructor(private readonly prisma: PrismaClient) {}

  async kindOf(projectId: string): Promise<string | null> {
    const cached = this.kinds.get(projectId);
    if (cached !== undefined) return cached;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { kind: true },
    });
    if (!project) return null;
    this.remember(projectId, project.kind);
    return project.kind;
  }

  async kindsOf(projectIds: readonly string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const missing: string[] = [];
    for (const projectId of new Set(projectIds)) {
      const cached = this.kinds.get(projectId);
      if (cached !== undefined) found.set(projectId, cached);
      else missing.push(projectId);
    }
    if (missing.length === 0) return found;
    const projects = await this.prisma.project.findMany({
      where: { id: { in: missing } },
      select: { id: true, kind: true },
    });
    for (const { id, kind } of projects) {
      this.remember(id, kind);
      found.set(id, kind);
    }
    return found;
  }

  private remember(projectId: string, kind: string): void {
    if (this.kinds.size >= MAX_CACHED_KINDS) {
      const oldest = this.kinds.keys().next().value;
      if (oldest !== undefined) this.kinds.delete(oldest);
    }
    this.kinds.set(projectId, kind);
  }
}

const readersByPrisma = new WeakMap<PrismaClient, PrismaProjectKindReader>();

/** One reader, and so one cache, per Prisma handle. */
export function projectKindReaderFor(
  prisma: PrismaClient,
): PrismaProjectKindReader {
  const existing = readersByPrisma.get(prisma);
  if (existing) return existing;
  const reader = new PrismaProjectKindReader(prisma);
  readersByPrisma.set(prisma, reader);
  return reader;
}

/**
 * The decision with the admin-only rule applied. An organisation admin, and
 * every decision the engine already refused, pass through untouched without a
 * read; everyone else pays one lookup of the project's kind (cached).
 */
export async function applyAggregateAdminGate<
  D extends Pick<PermissionDecision, "permitted" | "organizationRole">,
>({
  decision,
  projectId,
  kinds,
}: {
  decision: D;
  projectId: string;
  kinds: ProjectKindReader;
}): Promise<D> {
  if (!decision.permitted || decision.organizationRole === "ADMIN") {
    return decision;
  }
  const violation = aggregateProjectRouteViolation({
    kind: await kinds.kindOf(projectId),
    organizationRole: decision.organizationRole,
  });
  if (!violation) return decision;
  return { ...decision, permitted: false, denialReason: "no-binding" };
}

/**
 * The batch form of the same rule: of these projects, the aggregates a caller
 * with this organisation role may not open. Every batched permission answer
 * (the scope pickers, Langy's held permissions, an API key's project cut)
 * turns these to false, so a batch can never admit what a single check
 * refuses. An admin gets the empty set without a read; anyone else pays one
 * read of the kinds not yet cached.
 *
 * For an API key the role is its owner's, so a service key with no owner
 * (role null) is never admitted.
 */
export async function aggregatesClosedTo({
  projectIds,
  organizationRole,
  kinds,
}: {
  projectIds: readonly string[];
  organizationRole: string | null | undefined;
  kinds: ProjectKindReader;
}): Promise<ReadonlySet<string>> {
  if (organizationRole === "ADMIN" || projectIds.length === 0) {
    return new Set();
  }
  const kindById = await kinds.kindsOf(projectIds);
  return new Set(
    projectIds.filter((projectId) =>
      aggregateProjectRouteViolation({
        kind: kindById.get(projectId),
        organizationRole,
      }),
    ),
  );
}

/** The project answers with every closed aggregate turned to false. */
export function closeProjects(
  projects: ReadonlyMap<string, boolean>,
  closed: ReadonlySet<string>,
): Map<string, boolean> {
  return new Map(
    [...projects].map(([projectId, permitted]) => [
      projectId,
      permitted && !closed.has(projectId),
    ]),
  );
}

/** The ids a batch answered true for, the only ones worth a kind read. */
export function permittedIds(
  ...maps: ReadonlyArray<ReadonlyMap<string, boolean> | undefined>
): string[] {
  const ids = new Set<string>();
  for (const map of maps) {
    for (const [projectId, permitted] of map ?? []) {
      if (permitted) ids.add(projectId);
    }
  }
  return [...ids];
}
