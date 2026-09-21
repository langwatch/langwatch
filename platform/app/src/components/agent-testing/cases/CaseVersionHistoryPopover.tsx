/**
 * The version history of the case being edited, anchored to the version chip
 * of the dialog header.
 *
 * The history reads beside the case it belongs to rather than in a drawer over
 * it, so the dialog under it stays where it was, the way the prompt editor
 * reads its own versions.
 *
 * @see specs/features/agent-testing/case-version-history.feature
 */

import { Button, useDisclosure } from "@chakra-ui/react";
import { History } from "lucide-react";
import { useEffect } from "react";
import { Popover } from "~/components/ui/popover";
import { ScenarioVersionList } from "../drawers/ScenarioVersionList";
import { FG_MUTED } from "../shared/design";

export function CaseVersionHistoryPopover({
  scenarioId,
  version,
  initialOpen,
}: {
  scenarioId: string;
  version: number;
  /** True when the case was opened from a History entry rather than an edit. */
  initialOpen?: boolean;
}) {
  const { open, setOpen } = useDisclosure();

  useEffect(() => {
    if (initialOpen) setOpen(true);
  }, [initialOpen, setOpen]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={({ open: nextOpen }) => setOpen(nextOpen)}
      positioning={{ placement: "bottom-end" }}
    >
      <Popover.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          fontSize="12px"
          color={FG_MUTED}
          title="Every version of this scenario"
          data-testid="case-modal-history"
        >
          <History size={12} />v{version} · History
        </Button>
      </Popover.Trigger>
      <Popover.Content width="440px" data-testid="scenario-version-history">
        <Popover.Arrow />
        <Popover.Header fontWeight="semibold" fontSize="14px">
          Version history
        </Popover.Header>
        <Popover.CloseTrigger />
        <Popover.Body paddingTop={0}>
          {open && (
            <ScenarioVersionList
              scenarioId={scenarioId}
              markVersion={null}
              isCompact
            />
          )}
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
