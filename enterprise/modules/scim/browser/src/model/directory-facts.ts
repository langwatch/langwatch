// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the directory has been doing, from three reads: the reconciliation
 * projection, the groups the directory sent, and member provenance. Only the
 * RUNNING connections count; a removed one provisions nobody.
 */
import { isRunningConnection } from "./connection-lifecycle.ts";

type ConnectionFact = {
  connectionState: string;
  lastPushedAtMs: number | null;
  managedPeople: number;
};

export type DirectoryFacts<Connection extends ConnectionFact, Group> = {
  connections: Connection[];
  lastPushedAtMs: number | null;
  managedPeople: number;
  directoryGroups: Group[];
  memberCount: number;
  /** People the directory did not create: invited, or admitted by a domain. */
  outsideDirectory: number;
  insideDirectory: number;
};

export function directoryFactsOf<
  Connection extends ConnectionFact,
  Group extends { scimSource: string | null },
>({
  connections,
  groups,
  provenance,
}: {
  connections: readonly Connection[];
  groups: readonly Group[];
  provenance: Readonly<Record<string, { source: string }>>;
}): DirectoryFacts<Connection, Group> {
  const running = connections.filter(isRunningConnection);
  const lastPushedAtMs = running.reduce<number | null>(
    (latest, connection) =>
      connection.lastPushedAtMs !== null && (latest === null || connection.lastPushedAtMs > latest)
        ? connection.lastPushedAtMs
        : latest,
    null,
  );
  const members = Object.values(provenance);
  const outsideDirectory = members.filter((member) => member.source !== "directory").length;

  return {
    connections: running,
    lastPushedAtMs,
    managedPeople: running.reduce((total, connection) => total + connection.managedPeople, 0),
    directoryGroups: groups.filter((group) => group.scimSource !== null),
    memberCount: members.length,
    outsideDirectory,
    insideDirectory: members.length - outsideDirectory,
  };
}
