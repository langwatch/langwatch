/**
 * A person's daily insights for a board that is on: the run's choices, opened from Settings in
 * the board's dropdown.
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { Button, HStack, Spacer, Text } from "@langwatch/design-system/primitives";
import type { InsightRunSettings } from "@langwatch/insight-contract";
import { nowInstant } from "@langwatch/time";
import { useState } from "react";

import { DailyRunSettings } from "../blocks/daily-run-settings.tsx";

export function DailyInsightsDialog({
  boardName,
  settings,
  ownTimezone,
  note,
  onSubmit,
  onClose,
}: {
  boardName: string;
  /** A line the person should read before they save, when the board needs one. */
  note?: string;
  /** What the run's choices start at. */
  settings: InsightRunSettings;
  ownTimezone: string;
  onSubmit: (settings: InsightRunSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [now] = useState(() => nowInstant().epochMilliseconds);

  return (
    <Dialog.Root open size="md" onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title paddingRight={8}>{`Daily insights for ${boardName}`}</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body>
          <DailyRunSettings value={draft} ownTimezone={ownTimezone} now={now} onChange={setDraft} />
          <Text marginTop={1} textStyle="caption" color="fg.muted">
            This is your own setting, and only you see the insights it files.
          </Text>
          {note && (
            <Text marginTop={1} textStyle="caption" color="fg.muted">
              {note}
            </Text>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <HStack width="full" gap={3} flexWrap="wrap">
            <Spacer />
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button colorPalette="accent" onClick={() => onSubmit(draft)}>
              Save
            </Button>
          </HStack>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
