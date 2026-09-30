import { moduleApi } from "@langwatch/kernel/module-api";

/** A project's Slack connections; packet 07 fills this with main's list, create, update, delete. */
export interface SlackApi {}

export const SlackApi = moduleApi<SlackApi>()("slack");
