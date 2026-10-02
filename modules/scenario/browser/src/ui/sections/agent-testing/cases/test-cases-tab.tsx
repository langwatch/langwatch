/**
 * The Scenarios tab: the suites rail beside the table of scenarios.
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/features/agent-testing/cases-table.feature
 */

import { HStack, VStack } from "@langwatch/design-system/primitives";

import { TestCasesDialogs } from "./test-cases-dialogs.tsx";
import { TestCasesPanel } from "./test-cases-panel.tsx";
import { TestCasesRail } from "./test-cases-rail.tsx";
import { useTestCasesTab } from "./use-test-cases-tab.ts";

export function TestCasesTab() {
  const model = useTestCasesTab();
  // An empty project has nothing to file, so its setup prompt takes the whole page.
  const { data } = model;
  const isEmptyProject =
    !data.isLoading && !data.hasAgent && data.suites.length === 0 && data.externalSets.length === 0;

  return (
    <HStack
      width="full"
      height="full"
      gap={0}
      alignItems="stretch"
      data-testid="agent-testing-cases-tab"
    >
      {!isEmptyProject && <TestCasesRail model={model} />}

      <VStack align="stretch" flex={1} minWidth={0} gap={0}>
        <TestCasesPanel model={model} />
      </VStack>

      <TestCasesDialogs model={model} />
    </HStack>
  );
}
