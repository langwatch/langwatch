/** PR in address enables link-reopening; one key separates three values with "|". */

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
