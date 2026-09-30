/** The one procedure family this kit calls, derived from its owner's contract. */
import { type ContractApiMap, createModuleApi, type ModuleApi } from "@langwatch/api/web";
import type { slackIntegrationTrpc } from "@langwatch/slack-contract";

export const slackApi: ModuleApi<ContractApiMap<typeof slackIntegrationTrpc>> =
  createModuleApi<ContractApiMap<typeof slackIntegrationTrpc>>();
