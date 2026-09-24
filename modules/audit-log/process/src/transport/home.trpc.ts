import { defineTrpcRouter } from "@langwatch/api/trpc";
import { homeTrpc, type RecentItem } from "@langwatch/audit-log-contract";
import { moduleApi } from "@langwatch/kernel/module-api";

/** What the home door reaches: the entities this person most recently touched, newest first. */
export interface AuditLogHomeApi {
  getRecentItems(input: {
    userId: string;
    projectId: string;
    limit: number;
  }): Promise<RecentItem[]>;
}

export const AuditLogHomeApi = moduleApi<AuditLogHomeApi>()("audit-log");

export const homeTrpcTransport = defineTrpcRouter(AuditLogHomeApi, homeTrpc)
  .procedure("getRecentItems")
  .withPermission("project:view")
  .handle(({ app, input, actor }) =>
    app.getRecentItems({ userId: actor.id, projectId: input.projectId, limit: input.limit }),
  )
  .build();
