/**
 * The member's boards, stored as `Dashboard` rows: which one is theirs, the names new
 * boards get and the addresses in the area. Addresses are built and read here only.
 */

import { ORGANIZATION_DASHBOARDS_PATH } from "@langwatch/analytics-client";
import {
  DEFAULT_DASHBOARD_HOME_PRODUCT,
  type DashboardHomeProduct,
  MY_DASHBOARD_NAME,
  findMyDashboards,
  type MyDashboardCandidate,
} from "@langwatch/dashboard-contract";

export { MY_DASHBOARD_NAME };

/**
 * The member's own "My dashboard": the board marked theirs, whatever it is named, or on a row
 * the mark has not reached yet, the first they made under the default name.
 */
export function myDashboardId({
  boards,
  userId,
}: {
  boards: readonly (MyDashboardCandidate & { id: string })[];
  userId: string | undefined;
}): string | undefined {
  return findMyDashboards({ boards, userId })[0]?.id;
}

/** The address of the area, or of one board in it. */
export function dashboardsPath({
  projectSlug,
  dashboardId,
}: {
  projectSlug: string;
  dashboardId?: string;
}): string {
  const area = `/${projectSlug}/dashboards`;
  return dashboardId === void 0 ? area : `${area}/${encodeURIComponent(dashboardId)}`;
}

/** The templates library's segment; the route table ranks it above a board id, so none takes it. */
export const TEMPLATES_SEGMENT = "templates";

/** The From LangWatch boards' segment, ranked above a board id like the library's. */
export const CURATED_SEGMENT = "curated";

/**
 * A new board's segment: "+" opens an unsaved board here, stored on its first edit. Board ids
 * are generated and never read "new", so the board route keeps it.
 */
export const DRAFT_SEGMENT = "new";

/** The address of a new, unsaved board. */
export function draftBoardPath({ projectSlug }: { projectSlug: string }): string {
  return `${dashboardsPath({ projectSlug })}/${DRAFT_SEGMENT}`;
}

/** An address with a query, its empty keys left out; an empty query adds nothing. */
export function withQueryString({
  path,
  query,
}: {
  path: string;
  query: Readonly<Record<string, string | undefined>>;
}): string {
  const kept = Object.entries(query).flatMap(([key, value]) =>
    value === void 0 ? [] : [[key, value]],
  );
  return kept.length === 0 ? path : `${path}?${new URLSearchParams(kept).toString()}`;
}

/** The address of one From LangWatch board. */
export function curatedBoardPath({
  projectSlug,
  templateId,
}: {
  projectSlug: string;
  templateId: string;
}): string {
  return `${dashboardsPath({ projectSlug })}/${CURATED_SEGMENT}/${encodeURIComponent(templateId)}`;
}

export { ORGANIZATION_DASHBOARDS_PATH };

/** The address of a board in the organization's area, opened by id under no project. */
export function organizationBoardPath({ dashboardId }: { dashboardId: string }): string {
  return `${ORGANIZATION_DASHBOARDS_PATH}/${encodeURIComponent(dashboardId)}`;
}

/**
 * Whether an empty board offers the templates: they read LLM Ops data, so only an LLM Ops board
 * offers them (owner, 2026-11-23), at any address it is open at, in a project.
 */
export function offersTemplates({
  projectSlug,
  homeProduct,
}: {
  projectSlug: string;
  homeProduct: DashboardHomeProduct;
}): boolean {
  return projectSlug !== "" && homeProduct === DEFAULT_DASHBOARD_HOME_PRODUCT;
}

/** What the area has open, read from the address under `/dashboards/`. */
export type DashboardsPlace =
  | { readonly kind: "landing" }
  | { readonly kind: "templates" }
  | { readonly kind: "draft" }
  | { readonly kind: "board"; readonly dashboardId: string }
  | { readonly kind: "curated"; readonly templateId: string };

/** The place an address under the area opens; `openPath` is what follows `/dashboards/`. */
export function dashboardsPlace(openPath: string): DashboardsPlace {
  const [first, second] = openPath.split("/").map((segment) => decodeURIComponent(segment));
  if (!first) return { kind: "landing" };
  if (first === TEMPLATES_SEGMENT) return { kind: "templates" };
  if (first === DRAFT_SEGMENT) return { kind: "draft" };
  if (first === CURATED_SEGMENT && second) return { kind: "curated", templateId: second };
  return { kind: "board", dashboardId: first };
}

/**
 * The name a board gets when created blank, before the member renames it: the first
 * "Untitled dashboard N" none of `takenNames` has, the same rule in every place a board is made.
 */
export function untitledBoardName({ takenNames }: { takenNames: readonly string[] }): string {
  const names = new Set(takenNames);
  const candidates = Array.from(
    { length: names.size + 1 },
    (_, index) => `Untitled dashboard ${index + 1}`,
  );
  return candidates.find((name) => !names.has(name)) ?? `Untitled dashboard ${names.size + 1}`;
}

/** Whether a board still has the name `untitledBoardName` gave it, so a template may name it. */
export function isUntitledBoardName(name: string): boolean {
  return /^Untitled dashboard \d+$/.test(name);
}

/** The name a duplicate is offered before numbering: the board's, marked as a copy. */
export function boardCopyName(name: string): string {
  return `${name} copy`;
}

/** The name "Duplicate to edit" gives a From LangWatch board's own copy. */
export function curatedCopyName(name: string): string {
  return `${name} (copy)`;
}

/** A board made from a template takes its name, numbered from 2 when a board already has it. */
export function templateBoardName({
  templateName,
  existingNames,
}: {
  templateName: string;
  existingNames: readonly string[];
}): string {
  const taken = new Set(existingNames);
  const candidates = [
    templateName,
    ...Array.from({ length: taken.size }, (_, index) => `${templateName} ${index + 2}`),
  ];
  return candidates.find((name) => !taken.has(name)) ?? templateName;
}

/**
 * The board this project already made from a template, by the name `templateBoardName` gives
 * it under the template's name or a former one: no board column records its template. A
 * renamed board is no longer matched, so the template can be added again.
 */
export function boardFromTemplateId({
  templateNames,
  boards,
}: {
  /** The template's name, then the names it had before. */
  templateNames: readonly string[];
  boards: readonly { id: string; name: string }[];
}): string | undefined {
  for (const templateName of templateNames) {
    const found = boards.find((board) => isFromTemplate({ name: board.name, templateName }));
    if (found) return found.id;
  }
  return void 0;
}

/** Whether a board's name is the template's, or the template's numbered from 2 up. */
function isFromTemplate({ name, templateName }: { name: string; templateName: string }): boolean {
  if (name === templateName) return true;
  const prefix = `${templateName} `;
  const suffix = name.slice(prefix.length);
  const number = Number(suffix);
  return (
    name.startsWith(prefix) && Number.isInteger(number) && number >= 2 && String(number) === suffix
  );
}
