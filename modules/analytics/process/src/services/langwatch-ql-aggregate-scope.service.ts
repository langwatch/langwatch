/**
 * Who an aggregate project's LangWatchQL statement reads: the members its route's proof shares,
 * never the request's, each under its own key and from where its grant opens.
 * @see specs/lwql/aggregate-reads.feature
 * @see dev/docs/adr/177-aggregate-project-reads-member-projects-through-grants.md (v4.14)
 */
import {
  LangWatchQLMemberKeyMissingError,
  LangWatchQLTooManyMembersError,
  type LangWatchQLCaller,
  type LangWatchQLMemberWindow,
} from "@langwatch/analytics-contract";
import type { SharedWindow } from "@langwatch/authorization";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

import { LWQL_TENANT_CAPABILITY_MAX_PROJECTS } from "./langwatch-ql-capability.service.ts";

const logger = createLogger("langwatch:analytics:lwql:aggregate-scope");

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
   * The members behind the proof's `shared` windows. A grant with a closed end is left out: the
   * reconciler writes none, and no view can tell where a bucket that straddles the end belongs.
   * @throws {LangWatchQLTooManyMembersError} before any read, past the member cap.
   * @throws {LangWatchQLMemberKeyMissingError} naming every member whose key cannot be read.
   */
  async getMemberScope({
    shared,
  }: {
    shared: readonly SharedWindow[];
  }): Promise<LangWatchQLAggregateScope> {
    const open = shared.filter((window) => window.until === null);
    if (open.length < shared.length) {
      logger.warn(
        { left: shared.length - open.length },
        "aggregate LangWatchQL read left out members whose grant has an end",
      );
    }
    const maxMembers = this.deps.maxMembers ?? LWQL_TENANT_CAPABILITY_MAX_PROJECTS;
    if (open.length > maxMembers) {
      throw new LangWatchQLTooManyMembersError({ memberCount: open.length, maxMembers });
    }

    const found = await Promise.all(
      open.map(async (window) => ({
        window,
        project: await this.deps.projects.findById(window.projectId),
      })),
    );
    const missing = found
      .filter(({ project }) => !project?.lwqlKey)
      .map(({ window }) => window.projectId);
    if (missing.length > 0) throw new LangWatchQLMemberKeyMissingError({ projectIds: missing });

    return {
      projects: found.flatMap(({ project }) =>
        project?.lwqlKey ? [{ id: project.id, lwqlKey: project.lwqlKey }] : [],
      ),
      memberWindows: open.map((window) => ({ projectId: window.projectId, from: window.from })),
    };
  }
}
