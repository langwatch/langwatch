/**
 * The version history of the case being edited, anchored to the version chip of the
 * dialog header.
 * @see specs/features/agent-testing/case-version-history.feature
 */

import { Popover } from "@langwatch/design-system/popover";
import { Button, useDisclosure } from "@langwatch/design-system/primitives";
import { History } from "lucide-react";
import { useEffect } from "react";

import { ScenarioVersionList } from "../drawers/scenario-version-list.tsx";

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
          textStyle="caption"
          color="fg.muted"
          title="Every version of this scenario"
          data-testid="case-modal-history"
        >
          <History size={12} />v{version} · History
        </Button>
      </Popover.Trigger>
      <Popover.Content width="440px" data-testid="scenario-version-history">
        <Popover.Arrow />
        <Popover.Header fontWeight="semibold" textStyle="body">
          Version history
        </Popover.Header>
        <Popover.CloseTrigger />
        <Popover.Body paddingTop={0}>
          {open && <ScenarioVersionList scenarioId={scenarioId} markVersion={null} isCompact />}
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
