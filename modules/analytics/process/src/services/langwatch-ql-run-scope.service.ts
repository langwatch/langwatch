import {
  holdsAllWord,
  LWQL_ALL_STANDS_ALONE,
  LWQL_PROJECTS_SEND_ALL_OR_LIST,
  LangWatchQLProjectNotFoundError,
  type LangWatchQLCaller,
  type LangWatchQLExecuteInput,
  type LangWatchQLMemberWindow,
  type LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import { sharedWindowsReadBy, type Authorization } from "@langwatch/authorization";
import { ValidationError } from "@langwatch/handled-error";

import {
  narrowAggregate,
  selectNamedProjects,
} from "../rules/langwatch-ql-project-selection.rules.ts";
import type { LangWatchQLAggregateScopeService } from "./langwatch-ql-aggregate-scope.service.ts";
import type { LangWatchQLBoundsService } from "./langwatch-ql-bounds.service.ts";
import type { LangWatchQLQueryScopeService } from "./langwatch-ql-query-scope.service.ts";
import type { LangWatchQLReadableProjectsService } from "./langwatch-ql-readable-projects.service.ts";

/** Where a member's run reads: the caller's own project, an aggregate's members, or a named set. */
export type LangWatchQLRunScope =
  | Readonly<{ kind: "own" }>
  | Readonly<{
      kind: "aggregate";
      projects: readonly LangWatchQLCaller[];
      memberWindows: readonly LangWatchQLMemberWindow[];
    }>
  | Readonly<{
      kind: "named";
      projects: readonly LangWatchQLCaller[];
      protections: LangWatchQLProtections;
    }>;

type Dependencies = Readonly<{
  queryScope: Pick<LangWatchQLQueryScopeService, "resolveMemberProjects">;
  aggregateScope: Pick<LangWatchQLAggregateScopeService, "getMemberScope">;
  readable: Pick<LangWatchQLReadableProjectsService, "allIdsFor">;
  bounds: Pick<LangWatchQLBoundsService, "assertQueryWithinBounds">;
}>;

/**
 * Decides which projects one member's run reads, and counts the run against each one's window
 * before the engine sees it. The caller's authorization decides whether the project is an
 * aggregate whose members share windows; a named list is proven readable by the member.
 */
export class LangWatchQLRunScopeService {
  static create(dependencies: Dependencies): LangWatchQLRunScopeService {
    return new LangWatchQLRunScopeService(dependencies);
  }

  private constructor(private readonly dependencies: Dependencies) {}

  /**
   * The projects a request names; none when it names none.
   * @throws {ValidationError} when it names both `projectId` and `projects`, or "all" in a list.
   */
  select(request: {
    projectId?: string | undefined;
    projects?: readonly string[] | "all" | undefined;
  }): { named: readonly string[] | undefined; all: boolean } {
    const { named, all, conflict, stray } = selectNamedProjects(request);
    if (stray) throw new ValidationError(LWQL_PROJECTS_SEND_ALL_OR_LIST);
    if (conflict) throw new ValidationError("send projectId or projects, not both");
    if (Array.isArray(request.projects) && holdsAllWord(request.projects)) {
      throw new ValidationError(LWQL_ALL_STANDS_ALONE);
    }

    return { named, all };
  }

  /** @throws {LangWatchQLProjectNotFoundError} for a name the member may not read. */
  async resolve({
    authorization,
    project,
    selection,
    userId,
  }: Pick<LangWatchQLExecuteInput, "project" | "userId"> & {
    selection: { named: readonly string[] | undefined; all: boolean };
    authorization: Authorization | undefined;
  }): Promise<LangWatchQLRunScope> {
    const { queryScope, aggregateScope, bounds, readable } = this.dependencies;
    // "all" names the member's readable ids, then is checked per project as a named run is; the
    // second check costs what naming them costs, and the route's own permission covers "own".
    const named = selection.all
      ? await readable.allIdsFor({ projectId: project.id, userId })
      : selection.named;
    const shared = authorization
      ? sharedWindowsReadBy({ authorization, permission: "analytics:view", condition: "trace" })
      : [];
    await bounds.assertQueryWithinBounds({ projectId: project.id });

    if (shared.length > 0) {
      const aggregate = await aggregateScope.getMemberScope({ shared });
      if (named === undefined) return { kind: "aggregate", ...aggregate };
      const { scope, complete } = narrowAggregate({ aggregate, named });
      if (!complete) throw new LangWatchQLProjectNotFoundError();

      return { kind: "aggregate", ...scope };
    }
    if (named === undefined || (named.length === 1 && named[0] === project.id)) {
      return { kind: "own" };
    }
    if (userId === undefined) throw new LangWatchQLProjectNotFoundError();

    const scope = await queryScope.resolveMemberProjects({
      userId,
      projectIds: named,
      anchorProjectId: project.id,
      ...(authorization ? { authorization } : {}),
    });
    for (const member of scope.projects) {
      await bounds.assertQueryWithinBounds({ projectId: member.id });
    }

    return { kind: "named", ...scope };
  }
}
