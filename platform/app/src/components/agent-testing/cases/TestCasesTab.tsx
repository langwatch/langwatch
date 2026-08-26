/**
 * The Scenarios tab: the suites rail beside the table of cases.
 *
 * The reads and the writes of the tab live in useTestCasesTab. The rail, the
 * panel and the dialogs are views over the model it returns.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/features/agent-testing/cases-table.feature
 */

import { HStack, VStack } from "@chakra-ui/react";
import { TestCasesDialogs } from "./TestCasesDialogs";
import { TestCasesPanel } from "./TestCasesPanel";
import { TestCasesRail } from "./TestCasesRail";
import { useTestCasesTab } from "./useTestCasesTab";

export function TestCasesTab() {
  const model = useTestCasesTab();

  return (
    <HStack
      width="full"
      height="full"
      gap={0}
      alignItems="stretch"
      data-testid="agent-testing-cases-tab"
    >
      <TestCasesRail model={model} />

      <VStack align="stretch" flex={1} minWidth={0} gap={0}>
        <TestCasesPanel model={model} />
      </VStack>

      <TestCasesDialogs model={model} />
    </HStack>
  );
}
