/**
 * A person's daily insights for a board, in one dialog. On a board they never answered it is
 * the offer: what turning it on does, then the run itself. On a board that is on it holds
 * only the run. Closing it without an answer decides nothing.
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { Box, Button, HStack, Spacer, Text, VStack } from "@langwatch/design-system/primitives";
import type { InsightRunSettings } from "@langwatch/insight-contract";
import { nowInstant } from "@langwatch/time";
import { useState } from "react";

import { DailyRunSettings } from "../blocks/daily-run-settings.tsx";

export function DailyInsightsDialog({
  boardName,
  settings,
  ownTimezone,
  note,
  offer,
  onSubmit,
  onClose,
}: {
  boardName: string;
  /** A line the person should read before they answer, when the board needs one. */
  note?: string;
  /** What the run's choices start at. */
  settings: InsightRunSettings;
  ownTimezone: string;
  /** Present on a board the person never answered: the "no" that stores off. */
  offer?: { onDecline: () => void };
  /** "Turn on" on the offer, "Save" on a board that is on. */
  onSubmit: (settings: InsightRunSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [now] = useState(() => nowInstant().epochMilliseconds);

  return (
    <Dialog.Root open size="md" onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title paddingRight={8}>
            {offer ? `Turn on daily insights for ${boardName}?` : `Daily insights for ${boardName}`}
          </Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={5}>
            {offer && (
              <Text fontSize="12.5px" lineHeight="relaxed" color="fg.muted">
                Once a day, Langy reads the widgets on{" "}
                <Text as="span" fontWeight="medium" color="fg">
                  {boardName}
                </Text>{" "}
                and files what stands out in your Insights. You read it there, with the chart that
                proves it.
              </Text>
            )}
            <Box>
              {offer && (
                <Text marginBottom={1.5} fontSize="12.5px" fontWeight="semibold">
                  The daily run
                </Text>
              )}
              <DailyRunSettings
                value={draft}
                ownTimezone={ownTimezone}
                now={now}
                onChange={setDraft}
              />
              <Text marginTop={1} fontSize="12px" lineHeight="relaxed" color="fg.muted">
                This is your own setting, and only you see the insights it files.
              </Text>
              {note && (
                <Text marginTop={1} fontSize="12px" lineHeight="relaxed" color="fg.muted">
                  {note}
                </Text>
              )}
            </Box>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <HStack width="full" gap={3} flexWrap="wrap">
            {offer && (
              <Text flex={1} minWidth="13rem" fontSize="11.5px" color="fg.subtle">
                You can change this at any time from Daily insights on the board.
              </Text>
            )}
            <Spacer />
            <Button variant="ghost" onClick={offer ? offer.onDecline : onClose}>
              {offer ? "No thanks" : "Cancel"}
            </Button>
            <Button colorPalette="accent" onClick={() => onSubmit(draft)}>
              {offer ? "Turn on" : "Save"}
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
