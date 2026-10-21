/**
 * Who an aggregate project's LangWatchQL statement reads: the members its route's proof shares,
 * never the request's, each under its own key and from where its grant opens.
 * @see specs/lwql/aggregate-reads.feature
 * @see dev/docs/adr/177-aggregate-project-reads-member-projects-through-grants.md (v4.14)
 */
import {
  LangWatchQLMemberGrantClosedError,
  LangWatchQLMemberKeyMissingError,
  LangWatchQLTooManyMembersError,
  type LangWatchQLCaller,
  type LangWatchQLMemberWindow,
} from "@langwatch/analytics-contract";
import type { SharedWindow } from "@langwatch/authorization";
import type { ProjectApi } from "@langwatch/project-contract";

import { LWQL_TENANT_CAPABILITY_MAX_PROJECTS } from "./langwatch-ql-capability.service.ts";

/** The members an aggregate's statement runs over, and where each is read from. */
export type LangWatchQLAggregateScope = Readonly<{
  projects: readonly LangWatchQLCaller[];
  memberWindows: readonly LangWatchQLMemberWindow[];
}>;

type LangWatchQLAggregateScopeDependencies = Readonly<{
  projects: Pick<ProjectApi, "findById">;
  /** How many members one statement may name; the key set's own ceiling by default. */
  maxMembers?: number;
}>;

export class LangWatchQLAggregateScopeService {
  static create(deps: LangWatchQLAggregateScopeDependencies): LangWatchQLAggregateScopeService {
    return new LangWatchQLAggregateScopeService(deps);
  }

  private constructor(private readonly deps: LangWatchQLAggregateScopeDependencies) {}

  /**
   * The members behind the proof's `shared` windows.
   * @throws {LangWatchQLTooManyMembersError} before any read, past the member cap.
   * @throws {LangWatchQLMemberGrantClosedError} naming every member shared up to a date: the
   *   reconciler writes none, and no view can tell where a bucket that straddles the end belongs.
   * @throws {LangWatchQLMemberKeyMissingError} naming every member whose key cannot be read.
   */
  async getMemberScope({
    shared,
  }: {
    shared: readonly SharedWindow[];
  }): Promise<LangWatchQLAggregateScope> {
    const maxMembers = this.deps.maxMembers ?? LWQL_TENANT_CAPABILITY_MAX_PROJECTS;
    if (shared.length > maxMembers) {
      throw new LangWatchQLTooManyMembersError({ memberCount: shared.length, maxMembers });
    }

    const found = await Promise.all(
      shared.map(async (window) => ({
        window,
        project: await this.deps.projects.findById(window.projectId),
      })),
    );
    const closed = found.filter(({ window }) => window.until !== null);
    if (closed.length > 0) {
      throw new LangWatchQLMemberGrantClosedError({
        projectIds: closed.map(({ window }) => window.projectId),
        projectNames: closed.flatMap(({ project }) => (project ? [project.name] : [])),
      });
    }
    const missing = found.filter(({ project }) => !project?.lwqlKey);
    if (missing.length > 0) {
      throw new LangWatchQLMemberKeyMissingError({
        projectIds: missing.map(({ window }) => window.projectId),
        projectNames: missing.flatMap(({ project }) => (project ? [project.name] : [])),
      });
    }

    return {
      projects: found.flatMap(({ project }) =>
        project?.lwqlKey ? [{ id: project.id, lwqlKey: project.lwqlKey }] : [],
      ),
      memberWindows: shared.map((window) => ({ projectId: window.projectId, from: window.from })),
    };
  }
}
