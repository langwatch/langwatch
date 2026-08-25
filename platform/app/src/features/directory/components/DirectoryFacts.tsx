import { HStack, Spinner, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { IdentityChip } from "~/components/access/IdentityRow";

/** Sources named before the rest collapse into a count. */
const SOURCES_SHOWN = 3;

/**
 * The connected sources, named.
 *
 * A source is a connection an identity provider pushes through, and naming
 * the provider is what lets an administrator with two of them tell which one
 * is the one that stopped. The status tone rides on the chip rather than
 * standing in a cell of its own, so two sources in two states read as two
 * sources rather than as one confusing summary of both.
 */
export function DirectorySourceChips({
  connections,
}: {
  connections: Array<{
    connectionId: string;
    providerId: string;
    status: { headline: string; tone: string };
  }>;
}) {
  if (connections.length === 0) {
    // A STATUS, not an ornament. It is the same chip the connected sources
    // get, in the same place, saying which state this organization is in —
    // and it says WHY on hover, so a chip sitting on its own in a cell of a
    // band full of numbers is answering a question rather than decorating a
    // gap. Neutral, because nothing here has gone wrong: an organization that
    // has not connected a directory is not an organization with a broken one.
    return (
      <IdentityChip
        label="Not set up yet"
        title="No identity provider is connected, so nothing is provisioned here automatically."
        data-testid="directory-source-chip"
      />
    );
  }

  const shown = connections.slice(0, SOURCES_SHOWN);
  const rest = connections.length - shown.length;

  return (
    <HStack gap={1} flexWrap="wrap">
      {shown.map((connection) => (
        <IdentityChip
          key={connection.connectionId}
          label={`${connection.providerId} · ${connection.status.headline}`}
          tone={directorySourceTone(connection.status.tone)}
          title={connection.status.headline}
          data-testid="directory-source-chip"
        />
      ))}
      {rest > 0 && (
        <Text fontSize="xs" color="fg.muted">{`+${rest} more`}</Text>
      )}
    </HStack>
  );
}

function directorySourceTone(
  tone: string,
): "neutral" | "good" | "warning" | "bad" {
  if (tone === "working") return "good";
  if (tone === "attention") return "warning";
  return "neutral";
}

/**
 * A fact this reader cannot have, said as a word rather than as a number.
 *
 * A zero is an answer, and "you may not read this" is not, so the two must
 * never look the same: an administrator scanning for a directory that sent no
 * groups would otherwise read a permission boundary as a working sync with
 * nothing in it.
 */
export function DirectoryFactUnavailable({
  canRead,
  read,
  children,
}: {
  canRead: boolean;
  read: { isLoading: boolean; isError: boolean };
  children: ReactNode;
}) {
  const { isLoading, isError } = read;
  if (!canRead) {
    return (
      <Text fontSize="sm" color="fg.muted" title="Not yours to read.">
        Unavailable
      </Text>
    );
  }
  if (isError) {
    return (
      <Text fontSize="sm" color="fg.muted">
        Unavailable
      </Text>
    );
  }
  if (isLoading) return <Spinner size="xs" />;
  return <>{children}</>;
}
