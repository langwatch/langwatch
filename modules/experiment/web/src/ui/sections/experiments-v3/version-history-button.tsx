/**
 * VersionHistoryButton - the workbench's version history, anchored to its own button.
 */
import { Button, Text } from "@chakra-ui/react";
import { History } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Popover } from "@langwatch/design-system/popover";
import { useEvaluationsV3Store } from "../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { VersionList } from "./version-history-list.tsx";

type VersionHistoryButtonProps = {
  disabled?: boolean;
};

export function VersionHistoryButton({ disabled = false }: VersionHistoryButtonProps) {
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
      {/* No Tooltip around this trigger: Tooltip and Popover.Trigger both
        clone props onto the same child, the Tooltip's win, and the popover
        loses its anchor — floating-ui then renders the panel at the window
        origin. The button already says "History" in plain text, so a
        screen-reader name lives on the button, not a redundant tooltip. */}
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
