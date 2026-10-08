/**
 * The rules each `Project.kind` is held to (ADR-175). Pure and dependency-free
 * so ingest, listings, pickers and the browser ask one question the same way.
 */
import { PROJECT_KIND } from "./project.ts";

/** Whether this kind is the aggregate kind. */
export function isAggregateProjectKind(kind: string | null | undefined): boolean {
  return kind === PROJECT_KIND.AGGREGATE;
}

/**
 * The kinds the app never lands on when nobody chose a project: an aggregate
 * is opened on purpose, and the governance project is never user-visible.
 */
export const NEVER_LANDED_ON_PROJECT_KINDS: readonly string[] = [
  PROJECT_KIND.AGGREGATE,
  PROJECT_KIND.INTERNAL_GOVERNANCE,
];

/** The projects the app may land on when nobody chose one, in the order given. */
export function landableProjects<P extends { kind?: string | null }>(projects: readonly P[]): P[] {
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
 * The project with an aggregate's stored keys blanked: an aggregate owns no
 * credential (ADR-175 decision 7). Every other kind is returned unchanged.
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
 * Whether this organisation role may open a project of this kind (ADR-175
 * decision 5): only an organisation admin opens an aggregate. Every other kind
 * is left to the ordinary permission check, so it answers true here.
 */
export function mayOpenProjectKind({
  kind,
  organizationRole,
}: {
  kind: string | null | undefined;
  organizationRole: string | null | undefined;
}): boolean {
  return !isAggregateProjectKind(kind) || organizationRole === "ADMIN";
}

/**
 * The kinds this organisation role must not see in any project list: the
 * governance project for everyone, the aggregate for everyone but admins.
 */
export function projectKindsHiddenFrom(organizationRole: string | null | undefined): string[] {
  return organizationRole === "ADMIN"
    ? [PROJECT_KIND.INTERNAL_GOVERNANCE]
    : [PROJECT_KIND.INTERNAL_GOVERNANCE, PROJECT_KIND.AGGREGATE];
}

/** The refusal any trace destination gives when it resolves to an aggregate. */
export const AGGREGATE_PROJECT_INGEST_REFUSAL =
  "This project reads traces from other projects and does not receive traces of its own. Send traces to one of its member projects instead.";

/**
 * Whether traces may be sent to a project of this kind (ADR-175 decision 7).
 * Only the aggregate is refused here, with {@link AGGREGATE_PROJECT_INGEST_REFUSAL}.
 */
export function receivesTraces(kind: string | null | undefined): boolean {
  return !isAggregateProjectKind(kind);
}
