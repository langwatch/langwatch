/** Slack's connection procedures, derived from its contract; the kit fetches nothing (§3.4). */
import { type ContractApiMap, createModuleApi, type ModuleApi } from "@langwatch/api/web";
import type { slackIntegrationTrpc } from "@langwatch/slack-contract";

export type SlackApiMap = ContractApiMap<typeof slackIntegrationTrpc>;

export const slackApi: ModuleApi<SlackApiMap> = createModuleApi<SlackApiMap>();
