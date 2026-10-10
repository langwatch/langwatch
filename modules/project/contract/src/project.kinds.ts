/**
 * The rules each `Project.kind` carries (ADR-177). Pure and dependency-free:
 * ingest, the door, REST and every project listing ask these questions.
 */
import { PROJECT_KIND, type ProjectKind } from "./project.ts";

/** Whether this kind is the aggregate kind. */
export function isAggregateProjectKind(kind: string | null | undefined): boolean {
  return kind === PROJECT_KIND.AGGREGATE;
}

/** Which parts of the project navigation a project of this kind offers. */
export interface ProjectNavigation {
  home: boolean;
  /** The Observe section with Traces: every project that can be opened has it. */
  observe: true;
  /** Analytics, inside the Observe section. */
  analytics: boolean;
  onlineEvaluations: boolean;
  /** Agent testing or simulations, Experiments, Annotations. */
  test: boolean;
  /** Prompts, datasets, evaluators, workflows, automations and the rest. */
  build: boolean;
}

/**
 * A part of the navigation a project can go without. Observe is not one:
 * every project that can be opened has Traces.
 */
export type ProjectNavigationSection = Exclude<keyof ProjectNavigation, "observe">;

const EVERYTHING: ProjectNavigation = {
  home: true,
  observe: true,
  analytics: true,
  onlineEvaluations: true,
  test: true,
  build: true,
};

/**
 * ADR-177 decision 8: an aggregate is read only, so its navigation is Traces
 * alone; every other kind keeps the whole menu.
 */
export function projectNavigation(kind: string | null | undefined): ProjectNavigation {
  if (!isAggregateProjectKind(kind)) return EVERYTHING;
  return {
    home: false,
    observe: true,
    analytics: false,
    onlineEvaluations: false,
    test: false,
    build: false,
  };
}

/** Where opening a project lands: its home, or the Trace Explorer for a kind without one. */
export function projectEntryPath({
  slug,
  kind,
}: {
  slug: string;
  kind: string | null | undefined;
}): string {
  return projectNavigation(kind).home ? `/${slug}` : `/${slug}/traces`;
}

/**
 * The kinds the app never lands on when nobody chose a project: an aggregate
 * is opened on purpose from the switcher, the governance project never at all
 * (ADR-177 block F). Meant for a Prisma `kind: { notIn }` filter.
 */
export const NEVER_LANDED_ON_PROJECT_KINDS: readonly string[] = [
  PROJECT_KIND.AGGREGATE,
  PROJECT_KIND.INTERNAL_GOVERNANCE,
];

/** The projects whose kind is not in {@link NEVER_LANDED_ON_PROJECT_KINDS}, in order. */
export function findLandingProjects<P extends { kind?: string | null }>(
  projects: readonly P[],
): P[] {
  return projects.filter(
    (project) => !project.kind || !NEVER_LANDED_ON_PROJECT_KINDS.includes(project.kind),
  );
}

/**
 * Whether a project has traces to show. An aggregate receives none, so its own
 * `firstMessage` stays false while its members hold traces: it answers true.
 */
export function hasTracesToShow(project: { kind?: string | null; firstMessage: boolean }): boolean {
  return isAggregateProjectKind(project.kind) || project.firstMessage;
}

/** The kinds that never hold traces of their own, so no destination resolves to them. */
export const NON_DESTINATION_PROJECT_KINDS: readonly string[] = [
  PROJECT_KIND.INTERNAL_GOVERNANCE,
  PROJECT_KIND.AGGREGATE,
];

/**
 * The project row with an aggregate's stored keys blanked: an aggregate owns
 * no credential (ADR-177 decision 7). Every other kind is returned unchanged.
 */
export function withoutAggregateCredentials<
  P extends { kind: string; apiKey: string; lwqlKey: string },
>(project: P): P {
  return isAggregateProjectKind(project.kind) ? { ...project, apiKey: "", lwqlKey: "" } : project;
}

/** The refusal a non-admin gets from any route that opens an aggregate. */
export const AGGREGATE_PROJECT_ADMIN_ONLY_REFUSAL =
  "Only organization admins can open an aggregate project.";

/**
 * Whether this caller is refused this project (ADR-177 decision 5): only an
 * organisation admin opens an aggregate; the refusal is
 * {@link AGGREGATE_PROJECT_ADMIN_ONLY_REFUSAL}.
 */
export function isAggregateProjectRouteRefused({
  kind,
  organizationRole,
}: {
  kind: string | null | undefined;
  organizationRole: string | null | undefined;
}): boolean {
  return isAggregateProjectKind(kind) && organizationRole !== "ADMIN";
}

/** The kinds hidden from every project list for this organisation role. */
export function projectKindsHiddenFrom(organizationRole: string | null | undefined): ProjectKind[] {
  return organizationRole === "ADMIN"
    ? [PROJECT_KIND.INTERNAL_GOVERNANCE]
    : [PROJECT_KIND.INTERNAL_GOVERNANCE, PROJECT_KIND.AGGREGATE];
}

/** The refusal any trace destination gives when it resolves to an aggregate. */
export const AGGREGATE_PROJECT_INGEST_REFUSAL =
  "This project reads traces from other projects and does not receive traces of its own. Send traces to one of its member projects instead.";

/** Whether traces sent here are refused with {@link AGGREGATE_PROJECT_INGEST_REFUSAL} (ADR-177). */
export function isTraceDestinationRefused(kind: string | null | undefined): boolean {
  return isAggregateProjectKind(kind);
}
