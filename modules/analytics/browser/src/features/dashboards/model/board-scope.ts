/**
 * A board's scope as the browser reads it: what this reader may do with the board, and every
 * sentence the product says about scope, each naming the real project and organization. The
 * rules are the contract's, so the controls offered are the ones the server accepts. Pure.
 * @see modules/dashboard/specs/dashboards-v2.feature AC170 to AC186
 */

import {
  DASHBOARD_SCOPES,
  dashboardScopeLock,
  dashboardScopeLoss,
  type DashboardScope,
  type DashboardScopeLock,
} from "@langwatch/dashboard-contract";

export { DASHBOARD_SCOPES };

/** A board, as much of it as the scope rules and words read. */
export interface ScopedBoard {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly createdById: string | null;
  readonly scope: DashboardScope;
  readonly organizationId: string | null;
}

/** The project a board is read in, the reader, and what their role grants there. */
export interface BoardReader {
  readonly projectId: string;
  readonly organizationId: string | undefined;
  readonly userId: string | undefined;
  readonly mayCreate: boolean;
  readonly mayEdit: boolean;
  readonly mayDelete: boolean;
}

/** What one reader may do with one board, in the project they are in. */
export interface BoardAccess {
  /** False where the organization shows another project's board. */
  readonly isHome: boolean;
  /** Rename, describe, and add, move, edit or delete widgets. */
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  /** A copy of their own, which is what a reader who cannot edit is offered. */
  readonly canDuplicate: boolean;
  /** Why they cannot change the scope; "none" when they can. */
  readonly scopeLock: DashboardScopeLock;
}

export function boardAccess({
  board,
  reader,
}: {
  board: ScopedBoard;
  reader: BoardReader;
}): BoardAccess {
  const isHome = board.projectId === reader.projectId;
  return {
    isHome,
    canEdit: isHome && reader.mayEdit,
    canDelete: isHome && reader.mayDelete,
    canDuplicate: reader.mayCreate,
    scopeLock: dashboardScopeLock({
      board,
      viewer: reader.userId === void 0 ? void 0 : { userId: reader.userId },
      place: { projectId: reader.projectId, organizationId: reader.organizationId },
      mayEdit: reader.mayEdit,
    }),
  };
}

/** The names a sentence uses: the project that owns the board, and its organization. */
export interface ScopeNames {
  readonly project: string;
  readonly organization: string;
}

/** What the organization is called when its name has not arrived. */
export const ORGANIZATION_FALLBACK_NAME = "your organization";

/** Spelled as the prompt scope spells them. */
export const SCOPE_LABEL: Record<DashboardScope, string> = {
  PRIVATE: "Only me",
  PROJECT: "Project",
  ORGANIZATION: "Organization",
};

export const SCOPE_MENU = { title: "Scope", hint: "Who can see this dashboard." } as const;

/** One line for each choice: who can see the board. */
export function scopeHint({ scope, names }: { scope: DashboardScope; names: ScopeNames }): string {
  if (scope === "PRIVATE") return "Only you";
  if (scope === "PROJECT") return `Everyone in ${names.project}`;
  return `Everyone in ${names.organization}, in each of their projects`;
}

/** The scope badge's hover for a reader who can see the scope and cannot change it. */
export function scopeLockedTip({
  scope,
  lock,
  names,
}: {
  scope: DashboardScope;
  lock: Exclude<DashboardScopeLock, "none">;
  names: ScopeNames;
}): string {
  if (lock === "guest") {
    return `${names.organization} dashboard, owned by ${names.project}. It is read-only here: only ${names.project} can edit it. It shows the data of the project in the Project chip. To change it, duplicate it from its menu in the sidebar and edit the copy.`;
  }
  const seenBy = `${scopeHint({ scope, names })} can see this dashboard.`;
  if (lock === "no-permission") return `${seenBy} Your role cannot change that.`;
  return `${seenBy} Only the person who made this dashboard can change its scope.`;
}

/** The header badge on a board another project owns: who can edit it. */
export function guestBadgeLabel(names: ScopeNames): string {
  return `${names.organization} · owned by ${names.project}`;
}

/** The sidebar group that lists the organization's boards from other projects. */
export const fromOrganizationLabel = (organization: string): string => `From ${organization}`;

export const fromOrganizationTip = (organization: string): string =>
  `Dashboards that other projects in ${organization} set to Organization. Each one shows this project's data. They are read-only here. Duplicate one to make a copy you can edit.`;

/** What a row's scope mark says on hover; a Project board carries no mark. */
export function scopeMarkTip({
  scope,
  organization,
}: {
  scope: DashboardScope;
  organization: string;
}): string | undefined {
  if (scope === "PRIVATE") return "Only you can see this dashboard";
  if (scope === "ORGANIZATION") {
    return `Everyone in ${organization} can see this dashboard, in each of their projects`;
  }
  return void 0;
}

/** What a confirmation shows before a change of scope that takes the board from someone. */
export interface ScopeConfirmWords {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
}

const otherPeople = (count: number) => (count === 1 ? "1 other person" : `${count} other people`);

export function scopeConfirmWords({
  board,
  from,
  to,
  names,
  otherStars,
}: {
  board: string;
  from: DashboardScope;
  to: DashboardScope;
  names: ScopeNames;
  otherStars: number;
}): ScopeConfirmWords {
  const loss = dashboardScopeLoss({ from, to });
  const lines = [
    loss.otherProjects &&
      `People in the other projects of ${names.organization} will no longer see it. It leaves their "${fromOrganizationLabel(names.organization)}" list. Copies they made stay theirs.`,
    loss.teammates &&
      `It leaves the Dashboards list of everyone else in ${names.project}. Anyone who has it open is told it is not available the next time it loads.`,
    otherStars > 0 &&
      `${otherPeople(otherStars)} starred it. Their stars are kept, and come back if you widen the scope again.`,
  ];
  return {
    title:
      to === "PRIVATE"
        ? `Make "${board}" visible only to you?`
        : `Show "${board}" only to ${names.project}?`,
    message: lines.filter((line) => line !== false).join(" "),
    confirmLabel: `Set to ${SCOPE_LABEL[to]}`,
  };
}

/** The note after a change of scope, which offers Undo. */
export function scopeChangedNote({
  board,
  to,
  names,
}: {
  board: string;
  to: DashboardScope;
  names: ScopeNames;
}): string {
  if (to === "PRIVATE") return `Only you can see "${board}" now`;
  if (to === "PROJECT") return `Everyone in ${names.project} can see "${board}" now`;
  return `Everyone in ${names.organization} can see "${board}" now, each with their own project's data`;
}

/**
 * The page for a board the reader may not open. One text for a deleted board and an Only me
 * one: the server does not say which.
 */
export const BOARD_UNAVAILABLE = {
  title: "This dashboard is not available",
  body: "It was deleted, or the person who made it set its scope to Only me. If you need it, ask them to set it to Project.",
} as const;

/** The Project chip on an Organization board: whose data the board shows. */
export const PROJECT_CHIP = {
  name: "Project",
  menuHint: "Whose data this dashboard shows. One project at a time.",
  ownerTag: "owner",
} as const;

/** Under the Project menu: who can edit, kept apart from whose data is shown. */
export function projectMenuNote({
  owner,
  isHere,
  canOpenOwner,
}: {
  owner: string;
  isHere: boolean;
  canOpenOwner: boolean;
}): string {
  if (isHere) return `${owner} owns this dashboard, so it is edited here.`;
  return canOpenOwner
    ? `${owner} owns this dashboard. Choose it to edit the dashboard.`
    : `${owner} owns this dashboard. You do not have access to that project.`;
}
