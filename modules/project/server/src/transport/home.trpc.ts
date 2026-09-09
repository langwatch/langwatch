/**
 * The server half of `home.*`: the recent-items strip. The entities it names
 * arrive already hydrated, so this transport depends on none of their modules —
 * the deployment's reader walks the trail and the door asks for one person's rows.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { homeTrpc, type RecentItem } from "@langwatch/project-contract";
import { moduleApi } from "@langwatch/runtime-composition";

/**
 * What the home door reaches. The strip is not the project's own read: the
 * trail it walks belongs to the DEPLOYMENT, so it is named here rather than
 * reached for.
 */
export interface ProjectHomeApi {
  /**
   * The entities this person most recently touched in this project, newest
   * first and already hydrated with the name and link the strip renders.
   */
  getRecentItems(input: {
    userId: string;
    projectId: string;
    limit: number;
  }): Promise<RecentItem[]>;
}

export const ProjectHomeApi = moduleApi<ProjectHomeApi>("project");

export const homeTrpcTransport = defineTrpcRouter(ProjectHomeApi, homeTrpc)
  .procedure("getRecentItems")
  .withPermission("project:view")
  // The actor is the runtime's, resolved before the handler: a blank user id
  // here would widen the read to somebody else's trail rather than refusing it.
  .handle(({ app, input, actor }) =>
    app.getRecentItems({
      userId: actor.id,
      projectId: input.projectId,
      limit: input.limit,
    }),
  )
  .build();
