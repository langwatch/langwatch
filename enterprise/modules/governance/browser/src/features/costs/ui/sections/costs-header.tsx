// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Button, HStack, Heading, Spacer, Text } from "@chakra-ui/react";
import { Temporal } from "@langwatch/time";

import { SampleDataToggle } from "../../../../ui/elements/sample-data-controls.tsx";

/**
 * The page's title row: what it is, how old the figures are, and the two
 * controls that change either.
 *
 * The controls are SIBLINGS of the heading rather than nested in a group of
 * their own. The sample toggle sits beside the heading by design, and a
 * wrapper around it would put it in a different row as far as anything reading
 * the page structure is concerned.
 */
export function CostsHeader({
  lastReadAt,
  busy,
  onRefresh,
  showSample,
  onToggleSample,
}: {
  /** When the summary read's answer arrived, epoch ms. */
  lastReadAt: number | undefined;
  /** Whether the reads are in flight, so the control can say it is working. */
  busy: boolean;
  onRefresh: () => void;
  showSample: boolean;
  onToggleSample: () => void;
}) {
  return (
    <HStack align="center" gap={3}>
      <Heading size="md">Costs</Heading>
      <Spacer />
      <FiguresLastRead at={lastReadAt} />
      {/* `aria-busy` rather than a disabled control: a reader who sees nothing
          move clicks again, and a button that goes dead says nothing about
          why. */}
      <Button size="xs" variant="outline" aria-busy={busy} onClick={onRefresh}>
        Refresh
      </Button>
      <SampleDataToggle active={showSample} onToggle={onToggleSample} />
    </HStack>
  );
}

/**
 * When the figures on this screen were last read.
 *
 * An ABSOLUTE clock time, in the reader's own local time, never "9 hours ago".
 * A relative phrase goes stale the moment it is rendered and has to be
 * re-rendered to stay true, which is exactly the self-refreshing behaviour
 * this screen refuses; and the reader's real question — is this older than the
 * pull I am waiting on — is a comparison of two instants, which only an
 * absolute reading makes legible.
 *
 * Taken from when the ANSWER arrived, never from the render: a stamp on the
 * render says when the page was opened, which tells a reader nothing about how
 * old the money is.
 */
function FiguresLastRead({ at }: { at: number | undefined }) {
  if (!at) return null;
  return (
    <Text
      fontSize="xs"
      color="fg.muted"
      data-testid="cost-figures-last-read"
      fontVariantNumeric="tabular-nums"
    >
      Last read{" "}
      {Temporal.Instant.fromEpochMilliseconds(at).toLocaleString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </Text>
  );
}
