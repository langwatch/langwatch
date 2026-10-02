import type { SlackConnection } from "./slack-connection-types.ts";

/** A connection as a caller names it: only its id and name are read. */
export type NamedSlackConnection = Pick<SlackConnection, "id" | "name">;

/** The listed connection with this id, or none: the id may be gone or out of reach. */
export function findSlackConnection<T extends NamedSlackConnection>({
  connectionId,
  connections,
}: {
  connectionId: string | undefined;
  connections: readonly T[] | undefined;
}): T[] {
  if (!connectionId) return [];
  return (connections ?? []).filter((connection) => connection.id === connectionId);
}
