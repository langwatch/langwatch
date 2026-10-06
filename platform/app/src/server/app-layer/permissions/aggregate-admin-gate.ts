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
    if (this.kinds.size >= MAX_CACHED_KINDS) {
      const oldest = this.kinds.keys().next().value;
      if (oldest !== undefined) this.kinds.delete(oldest);
    }
    this.kinds.set(projectId, project.kind);
    return project.kind;
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
