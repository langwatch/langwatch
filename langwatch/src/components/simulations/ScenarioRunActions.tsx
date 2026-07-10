import { Box, Button, HStack, Icon, Text } from "@chakra-ui/react";
import {
  Edit2,
  ExternalLink,
  ListTree,
  MessagesSquare,
  MoreVertical,
  Play,
} from "lucide-react";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";

interface ScenarioRunActionsProps {
  /** The scenario data, or null/undefined if not found. */
  scenario: { archivedAt: Date | null } | null | undefined;
  /** Whether the scenario is currently being run. */
  isRunning: boolean;
  /** Called when the user clicks "Run again". */
  onRunAgain: () => void;
  /** Called when the user clicks "Edit scenario". */
  onEditScenario: () => void;
  /** When set, the overflow menu offers "Open thread". */
  onOpenThread?: (() => void) | null;
  /**
   * When set, the overflow menu offers "View conversation in Trace
   * Explorer" — the traces view filtered to this run's traces.
   */
  onOpenInTraces?: (() => void) | null;
  /** When set, the overflow menu offers "Open in DejaView". */
  dejaViewHref?: string | null;
}

/**
 * Compact action cluster for the run detail drawer header, matching the
 * Traces V2 drawer: ghost icon buttons for the high-frequency actions
 * (run again, edit) and one overflow menu absorbing the secondary ones,
 * so the title keeps the row's width.
 */
export function ScenarioRunActions({
  scenario,
  isRunning,
  onRunAgain,
  onEditScenario,
  onOpenThread,
  onOpenInTraces,
  dejaViewHref,
}: ScenarioRunActionsProps) {
  const isArchived = !!scenario && scenario.archivedAt !== null;
  const hasOverflow = !!onOpenThread || !!onOpenInTraces || !!dejaViewHref;

  if (!scenario && !hasOverflow) {
    return null;
  }

  return (
    <HStack gap={1} flexShrink={0}>
      {scenario && (
        <Tooltip
          content={
            isArchived
              ? "This scenario has been archived and cannot be run"
              : "Run again"
          }
          positioning={{ placement: "bottom" }}
        >
          <Button
            size="xs"
            variant="ghost"
            onClick={onRunAgain}
            loading={isRunning}
            disabled={isArchived}
            aria-label="Run again"
          >
            <Icon as={Play} boxSize={3.5} />
          </Button>
        </Tooltip>
      )}
      {scenario && !isArchived && (
        <Tooltip content="Edit scenario" positioning={{ placement: "bottom" }}>
          <Button
            size="xs"
            variant="ghost"
            onClick={onEditScenario}
            aria-label="Edit scenario"
          >
            <Icon as={Edit2} boxSize={3.5} />
          </Button>
        </Tooltip>
      )}
      {hasOverflow && (
        <Menu.Root positioning={{ placement: "bottom-end" }}>
          <Menu.Trigger asChild>
            <Button size="xs" variant="ghost" aria-label="More actions">
              <Icon as={MoreVertical} boxSize={3.5} />
            </Button>
          </Menu.Trigger>
          <Menu.Content minWidth="200px">
            {onOpenInTraces && (
              <Menu.Item value="open-in-traces" onClick={onOpenInTraces}>
                <HStack gap={2}>
                  <Icon as={ListTree} boxSize={3.5} />
                  <Text>View conversation in Trace Explorer</Text>
                </HStack>
              </Menu.Item>
            )}
            {onOpenThread && (
              <Menu.Item value="open-thread" onClick={onOpenThread}>
                <HStack gap={2}>
                  <Icon as={MessagesSquare} boxSize={3.5} />
                  <Text>Open thread</Text>
                </HStack>
              </Menu.Item>
            )}
            {dejaViewHref && (
              <Menu.Item value="deja-view" asChild>
                <a
                  href={dejaViewHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <HStack gap={2}>
                    <Icon as={ExternalLink} boxSize={3.5} />
                    <Text>Open in DejaView</Text>
                  </HStack>
                </a>
              </Menu.Item>
            )}
          </Menu.Content>
        </Menu.Root>
      )}
      <Box
        width="1px"
        height="16px"
        bg="border.muted"
        marginX={0.5}
        flexShrink={0}
      />
    </HStack>
  );
}
