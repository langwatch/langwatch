/**
 * The `Project.kind` values with rules of their own, and those rules.
 *
 * Framework-free and dependency-free on purpose: the permission adapters, the
 * ingest path, the REST API and every project listing ask these questions,
 * and none of them may pull the project service's storage clients onto its
 * import graph (doing so hangs every router unit test that imports the
 * permission adapters). Nor may they reach the enterprise tree to learn a
 * kind, which is why the governance kind is spelled here too.
 */

/**
 * The one `Project.kind` value that generic project routes must refuse.
 *
 * Spelled here rather than imported from the governance service so this module
 * — reached by ingest, the REST API and tRPC — carries no dependency on the
 * enterprise tree. The two are pinned together by
 * `governanceProjectKindGuard.unit.test.ts`.
 */
export const INTERNAL_GOVERNANCE_PROJECT_KIND = "internal_governance";

/**
 * ADR-144: a project that owns no traces and reads its member projects through
 * shared project-reader grants. Spelled here, beside the governance kind, for
 * the same reason.
 */
export const AGGREGATE_PROJECT_KIND = "aggregate";

/** Whether this kind is the aggregate kind. */
export function isAggregateProjectKind(
  kind: string | null | undefined,
): boolean {
  return kind === AGGREGATE_PROJECT_KIND;
}

/**
 * The kinds that never hold traces of their own, so no "send traces here"
 * picker offers them and no trace destination resolves to them. The governance
 * project receives ingestion-source data through its own path, never through
 * a picker; the aggregate receives nothing at all.
 */
export const NON_DESTINATION_PROJECT_KINDS: readonly string[] = [
  INTERNAL_GOVERNANCE_PROJECT_KIND,
  AGGREGATE_PROJECT_KIND,
];

/**
 * The project row with an aggregate's stored keys blanked. An aggregate owns
 * no credential (ADR-144 decision 7): its base key exists only because the
 * column is required, and neither it nor the LangWatchQL key is shown to
 * anyone, its admins included. Every other kind is returned unchanged.
 */
export function withoutAggregateCredentials<
  P extends { kind: string; apiKey: string; lwqlKey: string },
>(project: P): P {
  return isAggregateProjectKind(project.kind)
    ? { ...project, apiKey: "", lwqlKey: "" }
    : project;
}

/** The refusal a non-admin gets from any route that opens an aggregate. */
export const AGGREGATE_PROJECT_ADMIN_ONLY_REFUSAL =
  "Only organization admins can open an aggregate project.";

/**
 * Whether this caller may open this project, and the reason to refuse if not
 * (ADR-144 decision 5). An aggregate reads other people's personal projects,
 * so being on its team is not enough: only an organisation admin opens it.
 * Every other kind answers null and is left to the ordinary permission check.
 *
 * `organizationRole` is the caller's `OrganizationUser.role`, the same value
 * the permission engine hands back with every project decision; compared as a
 * string so this module carries no value import of the Prisma enum.
 */
export function aggregateProjectRouteViolation({
  kind,
  organizationRole,
}: {
  kind: string | null | undefined;
  organizationRole: string | null | undefined;
}): string | null {
  if (!isAggregateProjectKind(kind)) return null;
  return organizationRole === "ADMIN"
    ? null
    : AGGREGATE_PROJECT_ADMIN_ONLY_REFUSAL;
}

/**
 * The project kinds a caller with this organisation role must not see in any
 * project list: the governance project for everyone, and the aggregate for
 * everyone who is not an organisation admin. Meant for a Prisma
 * `kind: { notIn }` filter.
 */
export function projectKindsHiddenFrom(
  organizationRole: string | null | undefined,
): string[] {
  return organizationRole === "ADMIN"
    ? [INTERNAL_GOVERNANCE_PROJECT_KIND]
    : [INTERNAL_GOVERNANCE_PROJECT_KIND, AGGREGATE_PROJECT_KIND];
}

/** The refusal any trace destination gives when it resolves to an aggregate. */
export const AGGREGATE_PROJECT_INGEST_REFUSAL =
  "This project reads traces from other projects and does not receive traces of its own. Send traces to one of its member projects instead.";

/**
 * Whether traces may be sent to a project of this kind, and the reason to
 * refuse if not (ADR-144 decision 7). Only the aggregate is refused here: the
 * governance project's ingestion-source writes do not pass through the
 * destinations that ask this.
 */
export function traceDestinationViolation(
  kind: string | null | undefined,
): string | null {
  return isAggregateProjectKind(kind) ? AGGREGATE_PROJECT_INGEST_REFUSAL : null;
}
