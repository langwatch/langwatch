import type {
  SlackConnection,
  SlackConnectionList as SlackConnectionListOutput,
} from "@langwatch/slack-contract";

/** The list query's answer as the drawer reads it: its connections' instants arrive as strings. */
export type SlackConnectionList = Omit<SlackConnectionListOutput, "connections"> & {
  connections: SlackConnection[];
};
