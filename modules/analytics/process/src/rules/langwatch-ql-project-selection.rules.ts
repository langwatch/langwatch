import {
  LWQL_ALL_PROJECTS,
  type LangWatchQLCaller,
  type LangWatchQLMemberWindow,
} from "@langwatch/analytics-contract";

/** The members an aggregate's statement runs over, and where each is read from. */
export type MemberScope = Readonly<{
  projects: readonly LangWatchQLCaller[];
  memberWindows: readonly LangWatchQLMemberWindow[];
}>;

/**
 * The projects a request names: `projects`, or the one `projectId`; none when it names none.
 * `conflict` is set when it names both, which no door accepts.
 */
export function selectNamedProjects({
  projectId,
  projects,
}: {
  projectId?: string | undefined;
  projects?: readonly string[] | "all" | undefined;
}): { named: readonly string[] | undefined; all: boolean; conflict: boolean } {
  const all = projects === LWQL_ALL_PROJECTS;
  const list = all ? undefined : projects;

  return {
    named: list ?? (projectId === undefined ? undefined : [projectId]),
    all,
    conflict: projectId !== undefined && projects !== undefined,
  };
}

/**
 * An aggregate's members cut to the projects a card names. `complete` is false when a name is
 * not a member, which the caller answers with the one id-free refusal.
 */
export function narrowAggregate({
  aggregate,
  named,
}: {
  aggregate: MemberScope;
  named: readonly string[];
}): { scope: MemberScope; complete: boolean } {
  const wanted = new Set(named);
  const projects = aggregate.projects.filter((member) => wanted.has(member.id));

  return {
    complete: projects.length === wanted.size,
    scope: {
      projects,
      memberWindows: aggregate.memberWindows.filter((window) => wanted.has(window.projectId)),
    },
  };
}

/** Every project a key or member reads, in id order so the echoed list is stable. */
export function inStableOrder<Project extends { id: string }>(
  projects: readonly Project[],
): Project[] {
  return projects.toSorted((a, b) => Number(a.id > b.id) - Number(a.id < b.id));
}
