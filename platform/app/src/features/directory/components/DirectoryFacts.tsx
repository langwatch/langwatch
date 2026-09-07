import { Box, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { IdentityChip } from "~/components/access/IdentityRow";
import RouterLink from "~/utils/compat/next-link";

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
  addHref,
}: {
  connections: Array<{
    connectionId: string;
    providerId: string;
    status: { headline: string; tone: string };
  }>;
  /**
   * Where another source is connected. A reader who has just counted their
   * sources is the reader most likely to want one more, so the way to
   * Authentication sits beside the sources themselves. Omitted on the
   * Authentication page itself, where it would point at the page it is
   * already on.
   */
  addHref?: string;
}) {
  if (connections.length === 0) {
    // A STATUS, not an ornament. It is the same chip the connected sources
    // get, in the same place, saying which state this organization is in —
    // and it says WHY on hover, so a chip sitting on its own in a cell of a
    // band full of numbers is answering a question rather than decorating a
    // gap. Neutral, because nothing here has gone wrong: an organization that
    // has not connected a directory is not an organization with a broken one.
    // THE STATE, THE REASON, AND THE WAY OUT. "Not set up yet" on its own is
    // a label with nowhere to take it: a reader learns their directory is
    // empty and is left to work out both why it is empty and where the fix
    // lives. The reason is one clause and it belongs on screen, not on a
    // hover somebody has to discover, and the door is named rather than
    // drawn as a bare plus — there is nothing here yet to add one MORE to.
    return (
      <VStack align="start" gap={1}>
        <IdentityChip
          label="Not set up yet"
          title="No identity provider is connected, so nothing is provisioned here automatically."
          data-testid="directory-source-chip"
        />
        <Text fontSize="xs" color="fg.muted">
          Nobody is provisioned here automatically.
        </Text>
        {addHref ? (
          <Box
            asChild
            fontSize="xs"
            colorPalette="orange"
            color="colorPalette.fg"
          >
            <RouterLink href={addHref} data-testid="connect-identity-provider">
              Connect an identity provider →
            </RouterLink>
          </Box>
        ) : null}
      </VStack>
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
      <ConnectAnotherSource
        href={addHref}
        label="Connect another identity provider"
      />
    </HStack>
  );
}

/**
 * The way to one more source, drawn as a plus beside the sources themselves.
 *
 * It is the ONLY route from this page to Authentication now — a whole sentence
 * of a button used to sit under the page title saying the same thing, in the
 * one place a reader is looking for this page's own subject. So it is drawn a
 * step above the chips it stands with rather than level with them: big enough
 * to be found, still quiet enough that it is not the loudest thing on a band
 * of facts.
 *
 * The label is on the title and on the accessible name, never on screen: the
 * row it joins is a row of provider names, and a word here would be read as
 * another one.
 */
function ConnectAnotherSource({
  href,
  label,
}: {
  href: string | undefined;
  label: string;
}) {
  if (!href) return null;
  return (
    <Box
      asChild
      colorPalette="orange"
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      height="28px"
      minWidth="28px"
      borderRadius="full"
      borderWidth="1px"
      borderStyle="dashed"
      borderColor="border.emphasized"
      color="fg.muted"
      transition="all 0.15s ease"
      _hover={{
        borderStyle: "solid",
        borderColor: "colorPalette.solid",
        color: "colorPalette.fg",
        background: "colorPalette.subtle",
      }}
    >
      <RouterLink href={href} aria-label={label} title={label}>
        <Plus size={16} />
      </RouterLink>
    </Box>
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
  if (isLoading) return <Skeleton height="3.5" width="24" />;
  return <>{children}</>;
}
