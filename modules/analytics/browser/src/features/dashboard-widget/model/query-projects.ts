/**
 * What the editor's project row shows for a query: the projects it names that the member can
 * read, a count of those they cannot, and the projects the menu still offers (dashboards-v2
 * AC207, AC208b).
 */

import { LWQL_MAX_MEMBER_PROJECTS } from "@langwatch/analytics-contract/langwatch-ql-limits";

/** A project the member may read, as the picker names it. */
export interface PickableProject {
  readonly id: string;
  readonly name: string;
}

export interface QueryProjectsView {
  /** The named projects the member reads, with their position in the stored list. */
  readonly entries: readonly {
    readonly index: number;
    readonly id: string;
    readonly name: string;
  }[];
  /** Where the named projects the member cannot read sit in the stored list; no name, no id. */
  readonly hiddenAt: readonly number[];
  /** Readable projects not picked yet, in the order the organization lists them. */
  readonly offered: readonly PickableProject[];
  /** While the query stores none, it reads the board's project. */
  readonly followsBoard: boolean;
}

export function queryProjectsView({
  picked,
  readable,
}: {
  picked: readonly string[] | null | undefined;
  readable: readonly PickableProject[];
}): QueryProjectsView {
  const stored = picked ?? [];
  const byId = new Map(readable.map((project) => [project.id, project]));
  const entries = stored.flatMap((id, index) => {
    const project = byId.get(id);
    return project ? [{ index, id, name: project.name }] : [];
  });

  const hiddenAt = stored.flatMap((id, index) => (byId.has(id) ? [] : [index]));

  return {
    entries,
    hiddenAt,
    offered:
      stored.length >= LWQL_MAX_MEMBER_PROJECTS
        ? []
        : readable.filter((project) => !stored.includes(project.id)),
    followsBoard: stored.length === 0,
  };
}

/** The list with the entry at `index` dropped; an emptied list is stored as none. */
export function withoutProjectAt({
  picked,
  index,
}: {
  picked: readonly string[];
  index: number;
}): string[] | null {
  const next = picked.filter((_, at) => at !== index);

  return next.length === 0 ? null : next;
}
