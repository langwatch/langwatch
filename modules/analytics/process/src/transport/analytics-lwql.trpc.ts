/**
 * The server half of `analytics.lwql.*`, what the Custom query page calls.
 * `analytics:view` is checked first and the rollout gate second, so a member who
 * may not touch the project never learns whether the experiment is on for it.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */
import {
  analyticsLwqlTrpc,
  LangWatchQLNotEnabledError,
  type LangWatchQLAvailability,
  type LangWatchQLCaller,
  type LangWatchQLExecuteInput,
  type LangWatchQLProtections,
  type LangWatchQLQueryResult,
  type LangWatchQLSchema,
} from "@langwatch/analytics-contract";
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { moduleApi } from "@langwatch/kernel/module-api";

/**
 * What the workbench door reaches. The rollout gate and the caller resolution
 * are the process's: the flag store is a peer module, and the project's
 * LangWatchQL secret is read server-side and never leaves the handler.
 */
export interface AnalyticsLwqlApi {
  /** Whether this deployment has a LangWatchQL identity to run statements as. */
  isLangWatchQLAvailable(): boolean;
  /** The project's own rollout switch, read rather than enforced. */
  isWorkbenchEnabled(input: { projectId: string }): Promise<boolean>;
  /** Whether the Workbench is open to this project, and why not when it is not. */
  workbenchAvailability(input: { projectId: string }): Promise<LangWatchQLAvailability>;
  /** What this member may see of the project's content. */
  resolveProtections(input: { projectId: string; userId: string }): Promise<LangWatchQLProtections>;
  /** The project identity a member's execution runs under, and its protections. */
  resolveRunCaller(input: {
    projectId: string;
    userId: string;
  }): Promise<Readonly<{ project: LangWatchQLCaller; protections: LangWatchQLProtections }>>;
  describeLangWatchQLSchema(input: {
    projectId: string;
    protections: LangWatchQLProtections;
  }): Promise<LangWatchQLSchema>;
  executeLangWatchQL(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult>;
}

export const AnalyticsLwqlApi = moduleApi<AnalyticsLwqlApi>()("analytics");

/** The rollout gate, chained AFTER the permission check on every route but one. */
async function assertWorkbenchEnabled(app: AnalyticsLwqlApi, projectId: string): Promise<void> {
  if (await app.isWorkbenchEnabled({ projectId })) return;

  throw new LangWatchQLNotEnabledError();
}

export const analyticsLwqlTrpcTransport = defineTrpcRouter(AnalyticsLwqlApi, analyticsLwqlTrpc)
  .procedure("availability")
  .withPermission("analytics:view")
  .handle(({ app, input }) => app.workbenchAvailability({ projectId: input.projectId }))

  .procedure("schema")
  .withPermission("analytics:view")
  .handle(async ({ app, input, actor }) => {
    await assertWorkbenchEnabled(app, input.projectId);

    return app.describeLangWatchQLSchema({
      projectId: input.projectId,
      protections: await app.resolveProtections({
        projectId: input.projectId,
        userId: actor.id,
      }),
    });
  })

  .procedure("query")
  .withPermission("analytics:view")
  .handle(async ({ app, input, actor }) => {
    await assertWorkbenchEnabled(app, input.projectId);

    const { project, protections } = await app.resolveRunCaller({
      projectId: input.projectId,
      userId: actor.id,
    });

    return app.executeLangWatchQL({
      project,
      protections,
      sql: input.sql,
      ...(input.parameters ? { parameters: input.parameters } : {}),
      ...(input.timeWindow ? { timeWindow: input.timeWindow } : {}),
      ...(input.granularitySeconds === undefined
        ? {}
        : { granularitySeconds: input.granularitySeconds }),
    });
  })
  .build();
