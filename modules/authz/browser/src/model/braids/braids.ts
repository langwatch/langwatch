// Braids as the screens show them: rows from either side, the plan state, what the viewer may do.
// Spec: modules/authz/specs/braids-screen.feature. Decisions: ADR-185.

import { type AuthzBraid, BRAID_AUDIT_TARGET_KIND } from "@langwatch/authz-contract";
import { format } from "@langwatch/time";

/** Into other projects (this project owns the spans) or from other projects (it reads them). */
export type BraidSide = "into" | "from";

export type BraidProject = {
  id: string;
  name: string;
};

export type BraidRow = {
  braidId: string;
  side: BraidSide;
  /** The project at the other end from the page's own. */
  otherProject: BraidProject;
  /** The condition as written; null braids every span. */
  where: string | null;
  fromMs: number;
  /** Another braid on the same pair starts the same day, so the time tells them apart. */
  fromShowsTime: boolean;
  expiresAtMs: number | null;
  createdAtMs: number;
};

export type OrganizationBraidRow = {
  braidId: string;
  owner: BraidProject;
  reader: BraidProject;
  where: string | null;
  fromMs: number;
  fromShowsTime: boolean;
  expiresAtMs: number | null;
  createdAtMs: number;
};

type KnownProject = { id: string; name: string };

/** A project the viewer cannot see by name is still a project, never a blank. */
export function braidProject({
  projectId,
  projects,
}: {
  projectId: string;
  projects: readonly KnownProject[];
}): BraidProject {
  const name = projects.find((project) => project.id === projectId)?.name ?? "Another project";
  return { id: projectId, name };
}

function conditionOf(braid: AuthzBraid): string | null {
  const where = braid.where?.trim();
  return where ? where : null;
}

/** The braids sharing their pair and their From day with another braid. */
function sameDayOnPair(braids: readonly AuthzBraid[]): Set<string> {
  const keyOf = (braid: AuthzBraid) =>
    [braid.ownerProjectId, braid.readerProjectId, format(braid.fromMs, "yyyy-MM-dd")].join(" ");
  const counts = new Map<string, number>();
  for (const braid of braids) counts.set(keyOf(braid), (counts.get(keyOf(braid)) ?? 0) + 1);
  return new Set(
    braids.filter((braid) => (counts.get(keyOf(braid)) ?? 0) > 1).map((braid) => braid.braidId),
  );
}

function rowOf({
  braid,
  side,
  projects,
  sameDay,
}: {
  braid: AuthzBraid;
  side: BraidSide;
  projects: readonly KnownProject[];
  sameDay: ReadonlySet<string>;
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
    fromShowsTime: sameDay.has(braid.braidId),
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
  const sameDay = sameDayOnPair([...braids.intoOtherProjects, ...braids.fromOtherProjects]);
  return {
    into: braids.intoOtherProjects.map((braid) =>
      rowOf({ braid, side: "into", projects, sameDay }),
    ),
    from: braids.fromOtherProjects.map((braid) =>
      rowOf({ braid, side: "from", projects, sameDay }),
    ),
  };
}

export function organizationBraidRows({
  braids,
  projects,
}: {
  braids: readonly AuthzBraid[];
  projects: readonly KnownProject[];
}): OrganizationBraidRow[] {
  const sameDay = sameDayOnPair(braids);
  return braids.map((braid) => ({
    braidId: braid.braidId,
    owner: braidProject({ projectId: braid.ownerProjectId, projects }),
    reader: braidProject({ projectId: braid.readerProjectId, projects }),
    where: conditionOf(braid),
    fromMs: braid.fromMs,
    fromShowsTime: sameDay.has(braid.braidId),
    expiresAtMs: braid.expiresAtMs,
    createdAtMs: braid.createdAtMs,
  }));
}

/**
 * Enterprise: Braids works. Upsell: below Enterprise with nothing braided, the page sells.
 * Paused: below Enterprise with braids kept (ADR-185 §9), the braids show and are marked.
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

/** A braid's From day, with the time when another braid on its pair starts the same day. */
export function braidFromText({ fromMs, showsTime }: { fromMs: number; showsTime: boolean }) {
  return `From ${format(fromMs, showsTime ? "d MMM yyyy, HH:mm" : "d MMM yyyy")}`;
}

/** Where the audit log opens on one braid's history: its entries name the braid as target. */
export function braidAuditHref(braidId: string): string {
  const query = new URLSearchParams({ targetKind: BRAID_AUDIT_TARGET_KIND, targetId: braidId });
  return `/settings/audit-log?${query.toString()}`;
}

export const BRAIDS_GUIDE_HREF = "https://langwatch.ai/docs/features/braids";

/** The Braids page's tabs; `tab` in the query opens one, so a link can land on Signing keys. */
export const BRAIDS_TABS = ["into", "from", "keys"] as const;
export type BraidsTab = (typeof BRAIDS_TABS)[number];
export const BRAIDS_TAB_QUERY_KEY = "tab";

export function braidsTabOf(value: string | undefined): BraidsTab {
  return BRAIDS_TABS.find((tab) => tab === value) ?? "into";
}

/** Another project's Signing keys tab: the shell switches to the project, then returns here. */
export function braidsSigningKeysHref({ projectSlug }: { projectSlug: string }): string {
  const keys = `/settings/braids?${BRAIDS_TAB_QUERY_KEY}=keys`;
  return `/${encodeURIComponent(projectSlug)}?return_to=${encodeURIComponent(keys)}`;
}
