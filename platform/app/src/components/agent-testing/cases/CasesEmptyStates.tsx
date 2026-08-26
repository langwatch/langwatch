/**
 * What the cases panel reads when it has no row to draw.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { Box, Button, EmptyState } from "@chakra-ui/react";
import { FlaskConical, FolderCode, Plus } from "lucide-react";
import { FG_MUTED } from "../shared/design";

export type EmptyStateActionProps = {
  canManage: boolean;
  onNewTestCase: () => void;
};

/**
 * What a project with no scenario at all reads. It says what a scenario is
 * before it asks for one.
 */
export function FirstCaseEmptyState({
  canManage,
  onNewTestCase,
}: EmptyStateActionProps) {
  return (
    <EmptyState.Root paddingY={12} data-testid="agent-testing-first-case-empty">
      <EmptyState.Content>
        <EmptyState.Indicator>
          <FlaskConical size={28} />
        </EmptyState.Indicator>
        <EmptyState.Title>Write your first scenario</EmptyState.Title>
        <EmptyState.Description>
          A scenario is one situation you put your agent in, with the criteria
          it must meet. LangWatch plays the situation against your agent and a
          judge says whether each criterion was met.
        </EmptyState.Description>
        {canManage && (
          <Box paddingTop={2}>
            <Button size="sm" colorPalette="blue" onClick={onNewTestCase}>
              <Plus size={14} />
              New scenario
            </Button>
          </Box>
        )}
      </EmptyState.Content>
    </EmptyState.Root>
  );
}

/**
 * What a test suite that holds nothing yet reads. The New scenario button
 * sits in the panel header above, so the line only says what to do.
 */
export function NoCasesHereEmptyState() {
  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      background="bg.panel"
      paddingX={4}
      paddingY={4}
      fontSize="12px"
      color={FG_MUTED}
      data-testid="agent-testing-empty-suite"
    >
      Empty suite. Add a scenario, or move one here from another suite.
    </Box>
  );
}

/** What a set that runs from code reads before its first run lands. */
export function ExternalSetEmptyState() {
  return (
    <EmptyState.Root paddingY={12} data-testid="agent-testing-empty-external">
      <EmptyState.Content>
        <EmptyState.Indicator>
          <FolderCode size={28} />
        </EmptyState.Indicator>
        <EmptyState.Title>No runs in this period</EmptyState.Title>
        <EmptyState.Description>
          This set is written by code. Run it from the SDK or the command line,
          or widen the period.
        </EmptyState.Description>
      </EmptyState.Content>
    </EmptyState.Root>
  );
}
