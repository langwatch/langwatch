import { api } from "~/utils/api";
import { isRunningConnection } from "../logic/connectionLifecycle";

/**
 * What the directory has been doing, read once for every surface that asks.
 *
 * Two screens ask the same five questions — the Directory page's status band
 * and the Authentication overview's directory card — and they must not
 * disagree, which means neither may work the numbers out for itself. Each
 * number is read where it is already written: the reconciliation projection
 * for the sources, the push and the people, the group list for what the
 * directory sent, member provenance for who it does NOT manage.
 *
 * A hook rather than a component, because the two surfaces draw the same
 * facts in genuinely different shapes: a five-column band, and a card of four
 * lines beside a sign-on card.
 */
export function useDirectoryFacts({
  organizationId,
  canReadMembership,
}: {
  organizationId: string;
  /** Groups and provenance are both `organization:manage` reads; a reviewer
   *  holding only `sso:view` gets the other facts and an honest word rather
   *  than a zero they would read as an answer. */
  canReadMembership: boolean;
}) {
  const reconciliation = api.scimReconciliation.getAll.useQuery({
    organizationId,
  });
  const groups = api.group.listAll.useQuery(
    { organizationId },
    { enabled: canReadMembership && !!organizationId },
  );
  const provenance = api.organization.getMemberProvenance.useQuery(
    { organizationId },
    { enabled: canReadMembership && !!organizationId },
  );

  // The RUNNING ones. Every fact below is about what the directory is doing,
  // and a connection that has been removed is not doing any of it: it
  // provisions nobody, its tokens do nothing, and the last time it pushed is
  // not this organization's last sync. Counting them put "+1 more" beside the
  // live sources and made one working directory read as three. The removed
  // ones are not hidden — the Directory page keeps them under their own
  // heading, because the people they created are still members here.
  const connections = (reconciliation.data?.connections ?? []).filter(
    isRunningConnection,
  );
  const lastPushedAtMs = connections.reduce<number | null>(
    (latest, connection) =>
      connection.lastPushedAtMs !== null &&
      (latest === null || connection.lastPushedAtMs > latest)
        ? connection.lastPushedAtMs
        : latest,
    null,
  );
  const managedPeople = connections.reduce(
    (total, connection) => total + connection.managedPeople,
    0,
  );
  // A group the directory sent, as opposed to one somebody made here.
  const directoryGroups = (groups.data ?? []).filter(
    (group) => group.scimSource !== null,
  );

  const members = Object.values(provenance.data ?? {});
  const outsideDirectory = members.filter(
    (member) => member.source !== "directory",
  ).length;

  return {
    reconciliation,
    groups,
    provenance,
    connections,
    lastPushedAtMs,
    managedPeople,
    directoryGroups,
    members,
    /** People the directory did not create: invited, or admitted by a domain. */
    outsideDirectory,
    /** People it did. */
    insideDirectory: members.length - outsideDirectory,
  };
}
