/**
 * Which pull request the detail drawer is open on, kept in the address.
 *
 * `platform/app` opened this drawer through the application's drawer registry,
 * which writes the drawer's name and its scalar props into the query string.
 * That registry is application composition a feature-web package may not reach,
 * and the registered platform copy of the drawer dies with the pages it was
 * registered for. What the spec asks for is the behaviour rather than the
 * registry — the address carries the pull request, so the same link reopens it
 * (specs/coding-agent/pull-request-linkage.feature) — so the tables keep it in
 * a query key of their own and render the drawer inline. The same answer
 * `@langwatch/gateway-web`'s routing-policy editor gives.
 *
 * ONE KEY RATHER THAN THREE. A pull request is named by three values and they
 * are only meaningful together; three keys let a half-written address open a
 * drawer that queries for nothing. `|` separates them because a repository
 * host, an `owner/name` and a number can none of them contain one.
 */

/** The one pull request a detail drawer is about. */
export type PullRequestDetailRef = {
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
};

export const PULL_REQUEST_QUERY_KEY = "pullRequest";

const SEPARATOR = "|";

export function encodePullRequestRef(ref: PullRequestDetailRef): string {
  return [ref.repositoryHost, ref.repositoryFullName, String(ref.prNumber)].join(SEPARATOR);
}

/**
 * The reverse, and it refuses rather than guesses: an address a person edited
 * by hand opens no drawer instead of one querying for a pull request that
 * cannot exist.
 */
export function decodePullRequestRef(value: string | undefined): PullRequestDetailRef | null {
  if (!value) return null;
  const [repositoryHost, repositoryFullName, rawNumber, ...rest] = value.split(SEPARATOR);
  if (rest.length > 0) return null;
  if (!repositoryHost || !repositoryFullName || !rawNumber) return null;
  const prNumber = Number(rawNumber);
  if (!Number.isInteger(prNumber) || prNumber <= 0) return null;
  return { repositoryHost, repositoryFullName, prNumber };
}
