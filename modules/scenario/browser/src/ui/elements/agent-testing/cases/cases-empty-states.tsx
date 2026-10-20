/**
 * What the scenarios panel reads when it has no row to draw.
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { Card } from "@langwatch/design-system/card";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Text } from "@langwatch/design-system/primitives";
import { FlaskConical, FolderCode, Plus, FolderPlus, Plug } from "lucide-react";

export type EmptyStateActionProps = {
  canManage: boolean;
  onNewTestCase: () => void;
};

/**
 * What a project with no agent reads. Nothing can be tested until there is
 * something to test, so this is offered before a test suite is asked for.
 */
export function ConnectAgentEmptyState({
  canManage,
  onConnectAgent,
}: {
  canManage: boolean;
  onConnectAgent: () => void;
}) {
  return (
    <NoDataInfoBlock
      testId="agent-testing-connect-agent-empty"
      title="Set up agent"
      description="Connect the agent you want to test. LangWatch plays your scenarios against it and a judge says whether each criterion was met."
      icon={<Plug size={24} />}
    >
      {canManage && (
        <PageLayout.HeaderButton
          primary
          onClick={onConnectAgent}
          data-testid="agent-testing-connect-agent-setup"
        >
          <Plug size={16} /> Set up agent
        </PageLayout.HeaderButton>
      )}
    </NoDataInfoBlock>
  );
}

/**
 * What a project with no test suite reads. Every scenario sits in a suite, so
 * the first thing a new project names is one.
 */
export function FirstSuiteEmptyState({
  canManage,
  onNewSuite,
}: {
  canManage: boolean;
  onNewSuite: () => void;
}) {
  return (
    <NoDataInfoBlock
      testId="agent-testing-first-suite-empty"
      title="Name your first test suite"
      description="A test suite groups the scenarios you run together, for example the ones about refunds. Every scenario sits in one."
      icon={<FolderPlus size={24} />}
    >
      {canManage && (
        <PageLayout.HeaderButton
          primary
          onClick={onNewSuite}
          data-testid="agent-testing-first-suite-new"
        >
          <Plus size={16} /> New test suite
        </PageLayout.HeaderButton>
      )}
    </NoDataInfoBlock>
  );
}

/**
 * What a project with no scenario at all reads. It says what a scenario is
 * before it asks for one.
 */
export function FirstCaseEmptyState({ canManage, onNewTestCase }: EmptyStateActionProps) {
  return (
    <NoDataInfoBlock
      testId="agent-testing-first-case-empty"
      title="Write your first scenario"
      description="A scenario is one situation you put your agent in, with the criteria it must meet. LangWatch plays the situation against your agent and a judge says whether each criterion was met."
      icon={<FlaskConical size={24} />}
    >
      {canManage && (
        <PageLayout.HeaderButton
          primary
          onClick={onNewTestCase}
          data-testid="agent-testing-first-case-new"
        >
          <Plus size={16} /> New scenario
        </PageLayout.HeaderButton>
      )}
    </NoDataInfoBlock>
  );
}

/**
 * What a test suite that holds nothing yet reads. The New scenario button
 * sits in the panel header above, so the line only says what to do.
 */
export function NoCasesHereEmptyState() {
  return (
    <Card variant="panel" padding="md" data-testid="agent-testing-empty-suite">
      <Text textStyle="caption" color="fg.muted">
        Empty suite. Add a scenario, or move one here from another suite.
      </Text>
    </Card>
  );
}

/** What a set that runs from code reads before its first run lands. */
export function ExternalSetEmptyState() {
  return (
    <NoDataInfoBlock
      testId="agent-testing-empty-external"
      title="No runs in this period"
      description="This set is written by code. Run it from the SDK or the command line, or widen the period."
      icon={<FolderCode size={24} />}
    />
  );
}
