import type { SlackIntegrationKind } from "~/generated/prisma/client";
import type { RouterOutputs } from "~/utils/api";

export type SlackConnectionList = RouterOutputs["slackIntegration"]["list"];
export type SlackConnection = SlackConnectionList["connections"][number];

/** What the connection drawer hands back to whoever opened it. */
export interface SlackConnectionSaved {
  connectionId: string;
  kind: SlackIntegrationKind;
}
