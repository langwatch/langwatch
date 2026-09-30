import type { WireOf } from "@langwatch/api/web";
import type {
  SlackConnectionKind,
  SlackConnectionList as SlackConnectionListOutput,
} from "@langwatch/slack-contract";

/** The list query's answer as the browser holds it: its instants are ISO strings. */
export type SlackConnectionList = WireOf<SlackConnectionListOutput>;
export type SlackConnection = SlackConnectionList["connections"][number];

/** What the connection drawer hands back to whoever opened it. */
export interface SlackConnectionSaved {
  connectionId: string;
  name: string;
  kind: SlackConnectionKind;
}
