// Braids as the screens show them: rows from either side, the plan state, what the viewer may do.
// Spec: modules/authz/specs/braids-screen.feature. Decisions: ADR-201.

import { type AuthzBraid, BRAID_AUDIT_TARGET_KIND } from "@langwatch/authz-contract";
import { format, Temporal } from "@langwatch/time";

/** Into other projects (this project owns the spans) or from other projects (it reads them). */
export type BraidSide = "into" | "from";

/** Spans per braid over the last 24 hours: undefined while counting, "failed" if it could not. */
export type BraidActivityCounts = ReadonlyMap<string, number> | "failed" | undefined;

export type BraidProject = {
  id: string;
  name: string;
  /** Addresses the project's pages; absent when the host has not read it. */
  slug?: string;
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

type KnownProject = { id: string; name: string; slug?: string };

/** A project the viewer cannot see by name is still a project, never a blank. */
export function braidProject({
  projectId,
  projects,
}: {
  projectId: string;
  projects: readonly KnownProject[];
}): BraidProject {
  const known = projects.find((project) => project.id === projectId);
  if (!known) return { id: projectId, name: "Another project" };
  return known.slug
    ? { id: projectId, name: known.name, slug: known.slug }
    : { id: projectId, name: known.name };
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
 * Paused: below Enterprise with braids kept (ADR-201 §9), the braids show and are marked.
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

/**
 * Why the page's braids are paused: the plan, or the organisation's Braids setting turned off.
 * The plan pauses them with `release_braids` on or off: trace reads never honour a braid below
 * Enterprise (trace-braid-pause.service.ts).
 */
export function braidsPauses({
  planState,
  turnedOff,
}: {
  planState: BraidsPlanState;
  turnedOff: boolean;
}): { byPlan: boolean; byOrganization: boolean } {
  return {
    byPlan: planState === "paused",
    byOrganization: turnedOff && planState === "enterprise",
  };
}

/** What the not-enabled notice says of existing braids: applying, paused by whom, or unknown. */
export type BraidsStatus = "applying" | "organization" | "plan" | "unknown";

/**
 * The setting before the plan. The plan pauses whatever the setting says, so only an unread
 * setting with no plan pause leaves the status unknown: never "applying" on a guess.
 */
export function braidsStatus({
  byPlan,
  byOrganization,
  settingRead,
}: {
  byPlan: boolean;
  byOrganization: boolean;
  settingRead: boolean;
}): BraidsStatus {
  if (byOrganization) return "organization";
  if (byPlan) return "plan";
  return settingRead ? "applying" : "unknown";
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
  released = true,
  turnedOn = true,
}: {
  canManage: boolean;
  planState: BraidsPlanState;
  keptToOrganizationAdmins: boolean;
  /** `release_braids` off: the list is read-only but Remove stays (Alex, 2026-11-18). */
  released?: boolean;
  /** The organisation's "Braids enabled" setting off: the same, braids paused. */
  turnedOn?: boolean;
}): BraidAffordances {
  const working = canManage && planState === "enterprise" && released && turnedOn;
  return {
    canCreate: working,
    canEditInto: working,
    canRemove: canManage,
    showKeptToAdminsNote: keptToOrganizationAdmins && !canManage,
  };
}

/**
 * Where the audit log opens on one braid's history, its chip naming both projects. The entries
 * live in the owner's project, so a known owner slug switches there first.
 */
export function braidAuditHref({
  braidId,
  ownerName,
  readerName,
  ownerSlug,
}: {
  braidId: string;
  ownerName: string;
  readerName: string;
  ownerSlug?: string | undefined;
}): string {
  const query = new URLSearchParams({
    targetKind: BRAID_AUDIT_TARGET_KIND,
    targetId: braidId,
    targetLabel: `${ownerName} → ${readerName}`,
  });
  const log = `/settings/audit-log?${query.toString()}`;
  if (!ownerSlug) return log;
  return `/${encodeURIComponent(ownerSlug)}?return_to=${encodeURIComponent(log)}`;
}

export const BRAIDS_GUIDE_HREF = "https://langwatch.ai/docs/features/braids";
/** The organisation's Braids page, where its admins turn Braids on. */
export const ORGANIZATION_BRAIDS_HREF = "/settings/organization-braids";

/** The Braids page's sections; `section` in the query scrolls to one, as Signing keys links do. */
export const BRAIDS_SECTIONS = ["into", "from", "keys"] as const;
export type BraidsSection = (typeof BRAIDS_SECTIONS)[number];
export const BRAIDS_SECTION_QUERY_KEY = "section";

export function braidsSectionOf(value: string | undefined): BraidsSection | undefined {
  return BRAIDS_SECTIONS.find((section) => section === value);
}

/** Another project's Signing keys section: the shell switches to the project, then returns here. */
export function braidsSigningKeysHref({ projectSlug }: { projectSlug: string }): string {
  const keys = `/settings/braids?${BRAIDS_SECTION_QUERY_KEY}=keys`;
  return `/${encodeURIComponent(projectSlug)}?return_to=${encodeURIComponent(keys)}`;
}

const LABEL_CONDITION_LENGTH = 80;

/** A row menu's accessible name, its own on the page: other project, condition, start. */
export function braidRowActionsLabel(row: BraidRow): string {
  const direction = row.side === "into" ? "into" : "from";
  return braidActionsLabel({
    subject: `braid ${direction} ${row.otherProject.name}`,
    where: row.where,
    fromMs: row.fromMs,
  });
}

/** The organisation list's row menu name: both projects, the condition and the start. */
export function organizationBraidActionsLabel(row: OrganizationBraidRow): string {
  return braidActionsLabel({
    subject: `braid from ${row.owner.name} into ${row.reader.name}`,
    where: row.where,
    fromMs: row.fromMs,
  });
}

function braidActionsLabel({
  subject,
  where: written,
  fromMs,
}: {
  subject: string;
  where: string | null;
  fromMs: number;
}): string {
  const where = written?.trim();
  let condition = where || "every span";
  if (condition.length > LABEL_CONDITION_LENGTH) {
    condition = `${condition.slice(0, LABEL_CONDITION_LENGTH)}…`;
  }
  const start = Temporal.Instant.fromEpochMilliseconds(fromMs)
    .toString()
    .slice(0, 16)
    .replace("T", " ");
  return `Actions for the ${subject}, ${condition}, from ${start} UTC`;
}
