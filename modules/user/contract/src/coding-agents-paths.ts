/**
 * The address of the personal workspace this module's pages are served under. Every link,
 * redirect and route row reads it from here, so a rename edits one file.
 * @see specs/navigation/coding-agents-url-move.feature
 */

/** The first path segment of the personal workspace; also a reserved project slug. */
export const CODING_AGENTS_SEGMENT = "coding-agents";

/** The personal workspace's home. */
export const CODING_AGENTS_PATH = `/${CODING_AGENTS_SEGMENT}` as const;

/** The segment the personal workspace had before `/coding-agents`; old links still carry it. */
export const RETIRED_PERSONAL_SEGMENT = "me";

/** The personal workspace's retired home, read as personal scope and redirected. */
export const RETIRED_PERSONAL_PATH = `/${RETIRED_PERSONAL_SEGMENT}` as const;

/** Each page under the personal workspace's home, as the path after it. */
export type CodingAgentsPage = "configure" | "sessions" | "pull-requests" | "budget/request";

/**
 * An address in the personal workspace: its home, or one of its pages, with an optional query.
 * An empty query adds no `?`.
 */
export function codingAgentsPath({
  page,
  query,
}: {
  page?: CodingAgentsPage;
  query?: URLSearchParams | Readonly<Record<string, string>>;
} = {}): string {
  const path = page ? `${CODING_AGENTS_PATH}/${page}` : CODING_AGENTS_PATH;
  const search = query ? new URLSearchParams(query).toString() : "";

  return search ? `${path}?${search}` : path;
}
