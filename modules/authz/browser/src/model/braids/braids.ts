// Braids as the screens show them: rows from either side, the plan state, what the viewer may do.
// Spec: modules/authz/specs/braids-screen.feature. Decisions: ADR-183.

import type { AuthzBraid } from "@langwatch/authz-contract";

/** Into other projects (this project owns the spans) or from other projects (it reads them). */
export type BraidSide = "into" | "from";

/** Which of the three Braids project colours a project's strand takes, always beside initials. */
export type BraidStrand = 1 | 2 | 3;

export type BraidProject = {
  id: string;
  name: string;
  initials: string;
  strand: BraidStrand;
};

export type BraidRow = {
  braidId: string;
  side: BraidSide;
  /** The project at the other end from the page's own. */
  otherProject: BraidProject;
  /** The condition as written; null braids every span. */
  where: string | null;
  fromMs: number;
  expiresAtMs: number | null;
  createdAtMs: number;
};

export type OrganizationBraidRow = {
  braidId: string;
  owner: BraidProject;
  reader: BraidProject;
  where: string | null;
  fromMs: number;
  expiresAtMs: number | null;
  createdAtMs: number;
};

type KnownProject = { id: string; name: string };

/** Up to two letters, from the first two words, so colour is never the only cue. */
export function projectInitials(name: string): string {
  const letters = name
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return letters.length > 0 ? letters : "?";
}

/** Stable per project, so a project keeps its colour on every row and screen. */
export function strandOf(projectId: string): BraidStrand {
  let sum = 0;
  for (const character of projectId) sum = (sum * 31 + character.charCodeAt(0)) % 9973;
  return ((sum % 3) + 1) as BraidStrand;
}

/** A project the viewer cannot see by name is still a project, never a blank. */
export function braidProject({
  projectId,
  projects,
}: {
  projectId: string;
  projects: readonly KnownProject[];
}): BraidProject {
  const name = projects.find((project) => project.id === projectId)?.name ?? "Another project";
  return { id: projectId, name, initials: projectInitials(name), strand: strandOf(projectId) };
}

function conditionOf(braid: AuthzBraid): string | null {
  const where = braid.where?.trim();
  return where ? where : null;
}

function rowOf({
  braid,
  side,
  projects,
}: {
  braid: AuthzBraid;
  side: BraidSide;
  projects: readonly KnownProject[];
}): BraidRow {
  return {
    braidId: braid.braidId,
    side,
    otherProject: braidProject({
      projectId: side === "into" ? braid.readerProjectId : braid.ownerProjectId,
      projects,
    }),
    where: conditionOf(braid),
    fromMs: braid.fromMs,
    expiresAtMs: braid.expiresAtMs,
    createdAtMs: braid.createdAtMs,
  };
}

export function projectBraidRows({
  braids,
  projects,
}: {
  braids: { intoOtherProjects: readonly AuthzBraid[]; fromOtherProjects: readonly AuthzBraid[] };
  projects: readonly KnownProject[];
}): { into: BraidRow[]; from: BraidRow[] } {
  return {
    into: braids.intoOtherProjects.map((braid) => rowOf({ braid, side: "into", projects })),
    from: braids.fromOtherProjects.map((braid) => rowOf({ braid, side: "from", projects })),
  };
}

export function organizationBraidRows({
  braids,
  projects,
}: {
  braids: readonly AuthzBraid[];
  projects: readonly KnownProject[];
}): OrganizationBraidRow[] {
  return braids.map((braid) => ({
    braidId: braid.braidId,
    owner: braidProject({ projectId: braid.ownerProjectId, projects }),
    reader: braidProject({ projectId: braid.readerProjectId, projects }),
    where: conditionOf(braid),
    fromMs: braid.fromMs,
    expiresAtMs: braid.expiresAtMs,
    createdAtMs: braid.createdAtMs,
  }));
}

/**
 * Enterprise: Braids works. Upsell: below Enterprise with nothing braided, the page sells.
 * Paused: below Enterprise with braids kept (ADR-183 §9), the braids show and are marked.
 */
export type BraidsPlanState = "enterprise" | "upsell" | "paused";

export function braidsPlanState({
  isEnterprise,
  braidCount,
}: {
  isEnterprise: boolean;
  braidCount: number;
}): BraidsPlanState {
  if (isEnterprise) return "enterprise";
  return braidCount > 0 ? "paused" : "upsell";
}

export type BraidAffordances = {
  canCreate: boolean;
  /** Edit is the owner side's alone; a reader's admins may only remove. */
  canEditInto: boolean;
  /** Removal stays open below Enterprise: stopping a braid only narrows access. */
  canRemove: boolean;
  /** The organisation keeps braids to its admins and this viewer is not one of them. */
  showKeptToAdminsNote: boolean;
};

export function braidAffordances({
  canManage,
  planState,
  keptToOrganizationAdmins,
}: {
  canManage: boolean;
  planState: BraidsPlanState;
  keptToOrganizationAdmins: boolean;
}): BraidAffordances {
  const working = canManage && planState === "enterprise";
  return {
    canCreate: working,
    canEditInto: working,
    canRemove: canManage,
    showKeptToAdminsNote: keptToOrganizationAdmins && !canManage,
  };
}

/** Where the audit log opens on one braid's history. */
export function braidAuditHref(braidId: string): string {
  return `/settings/audit-log?targetId=${encodeURIComponent(braidId)}`;
}

export const BRAIDS_GUIDE_HREF = "https://langwatch.ai/docs/features/braids";
