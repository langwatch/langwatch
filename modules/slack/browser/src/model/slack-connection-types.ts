import type {
  SlackConnectionKind,
  SlackConnectionList as SlackConnectionListOutput,
  SlackManagedConnection,
} from "@langwatch/slack-contract";

/** A listed connection as the kit reads it; its instants, which reach it as strings, are unread. */
export type SlackConnection = Omit<SlackManagedConnection, "createdAt" | "updatedAt">;

/** The list query's answer as the kit reads it. */
export type SlackConnectionList = Omit<SlackConnectionListOutput, "connections"> & {
  connections: SlackConnection[];
};

/** What the connection drawer hands back to whoever opened it. */
export interface SlackConnectionSaved {
  connectionId: string;
  name: string;
  kind: SlackConnectionKind;
}
