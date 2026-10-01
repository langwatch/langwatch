/**
 * The server half of `integrationsChecks.*`: how far a project has been set up.
 * Main's onboarding checks; each figure is counted by the module that owns it.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { moduleApi } from "@langwatch/module";
import {
  integrationsChecksTrpc,
  type IntegrationsCheckStatus,
} from "@langwatch/onboarding-contract";

/** What the setup-checklist door reaches on the onboarding app. */
export interface IntegrationsChecksApi {
  getCheckStatus(input: { projectId: string }): Promise<IntegrationsCheckStatus>;
}

export const IntegrationsChecksApi = moduleApi<IntegrationsChecksApi>()("onboarding");

export const integrationsChecksTrpcTransport: TrpcRouterDeclaration<
  IntegrationsChecksApi,
  typeof integrationsChecksTrpc
> = defineTrpcRouter(IntegrationsChecksApi, integrationsChecksTrpc)
  .procedure("getCheckStatus")
  /** `project:update`, main's gate: a reader who cannot change the project cannot act on a step. */
  .withPermission("project:update")
  .handle(({ app, input }) => app.getCheckStatus({ projectId: input.projectId }))
  .build();
