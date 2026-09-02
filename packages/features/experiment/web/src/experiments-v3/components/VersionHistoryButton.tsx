/**
 * VersionHistoryButton - the workbench's version history, anchored to its own
 * button.
 *
 * Sits beside the results button in the workbench header. The history is a
 * short list a reader checks and leaves, so it opens as a popover on the
 * button rather than as a drawer over the workbench: the setup the versions
 * describe stays on screen behind it, and closing it costs nothing. The list
 * scrolls inside the popover, so a long history never pushes the popover past
 * the window.
 */
import { Button, Text } from "@chakra-ui/react";
import { History } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Popover } from "@langwatch/design-system/popover";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { VersionList } from "./VersionHistoryList";

type VersionHistoryButtonProps = {
  disabled?: boolean;
};

export function VersionHistoryButton({
  disabled = false,
}: VersionHistoryButtonProps) {
  const { project } = useOrganizationTeamProject();
  const [isOpen, setIsOpen] = useState(false);

  const { experimentId, experimentSlug } = useEvaluationsV3Store(
    useShallow((state) => ({
      experimentId: state.experimentId,
      experimentSlug: state.experimentSlug,
    })),
  );

  // Nothing has a history until it has been saved once.
  if (!project || !experimentId || !experimentSlug) return null;

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={({ open }) => setIsOpen(open)}
      positioning={{ placement: "bottom-end" }}
    >
      {/*
        No Tooltip around this trigger. Both Tooltip and Popover.Trigger clone
        their props onto the same child, the Tooltip's win, and the popover is
        left with no anchor registered: floating-ui then computes no position
        and the panel renders at the window origin instead of under the button.
        The button says "History" in plain text anyway, so a tooltip repeating
        it bought nothing. The name a screen reader reads stays on the button.
      */}
      <Popover.Trigger asChild>
        <Button
          size="sm"
          variant="ghost"
          color="fg.muted"
          _hover={{ color: "fg", bg: "bg.subtle" }}
          disabled={disabled}
          aria-label="Version history"
        >
          <History size={18} />
          History
        </Button>
      </Popover.Trigger>
      <Popover.Content width="420px" maxWidth="calc(100vw - 32px)">
        <Popover.Arrow />
        <Popover.Body
          maxHeight="min(60vh, 480px)"
          overflowY="auto"
          data-testid="version-history-popover"
        >
          <Text fontWeight="semibold" fontSize="sm">
            Version history
          </Text>
          <VersionList
            experimentId={experimentId}
            experimentSlug={experimentSlug}
            onRestored={() => setIsOpen(false)}
          />
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
