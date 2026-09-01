/**
 * Compact autosave indicator: nothing while idle, a spinner while saving, a
 * check on success, and a loud error with the message when a save fails.
 *
 * A blocked save must never look like a successful one, which is why the error
 * state is a state of its own rather than a silent return to idle.
 */

import { HStack, Spinner, Text } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Check, X } from "lucide-react";
import type { AutosaveState } from "../../model/dataset-table-context";

export function SaveStatusChip({ state, error }: { state: AutosaveState; error?: string }) {
  if (state === "saving") {
    return (
      <HStack gap={1} color="fg.muted" data-testid="save-status-saving">
        <Spinner size="xs" />
        <Text fontSize="12px">Saving…</Text>
      </HStack>
    );
  }
  if (state === "saved") {
    return (
      <HStack gap={1} color="green.fg" data-testid="save-status-saved">
        <Check size={13} />
        <Text fontSize="12px">Saved</Text>
      </HStack>
    );
  }
  if (state === "error") {
    return (
      <Tooltip content={error ?? "Unknown error"}>
        <HStack gap={1} color="red.fg" data-testid="save-status-error">
          <X size={13} />
          <Text fontSize="12px">Failed to save</Text>
        </HStack>
      </Tooltip>
    );
  }
  return null;
}
