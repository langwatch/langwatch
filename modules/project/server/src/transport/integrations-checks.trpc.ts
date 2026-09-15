/**
 * The server half of `integrationsChecks.*`: how far a project has been set up.
 * The counts are not the project's to read — nine verticals hold the evidence —
 * so the whole rollup arrives through the door's own api.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { integrationsChecksTrpc, type IntegrationsCheckStatus } from "@langwatch/project-contract";
import { moduleApi } from "@langwatch/runtime-composition";

/** What the setup-checklist door reaches, which is nobody's single vertical. */
export interface IntegrationsChecksApi {
  /**
   * Which setup steps this project has completed. The deployment's reader fans
   * out across the verticals holding the evidence; a datastore it cannot reach
   * counts as "not done" rather than failing the whole answer.
   */
  getCheckStatus(input: { projectId: string }): Promise<IntegrationsCheckStatus>;
}

export const IntegrationsChecksApi = moduleApi<IntegrationsChecksApi>("project");

export const integrationsChecksTrpcTransport = defineTrpcRouter(
  IntegrationsChecksApi,
  integrationsChecksTrpc,
)
  .procedure("getCheckStatus")
  /**
   * `project:update` rather than `project:view`: the answer drives the setup
   * checklist, and a reader who cannot change the project cannot act on a
   * single step it lists. The gate this surface has always carried.
   */
  .withPermission("project:update")
  .handle(({ app, input }) => app.getCheckStatus({ projectId: input.projectId }))
  .build();
