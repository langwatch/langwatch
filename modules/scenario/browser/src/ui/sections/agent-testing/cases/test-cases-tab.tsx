/**
 * The Scenarios tab: the suites rail beside the table of scenarios.
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/features/agent-testing/cases-table.feature
 */

import { Stack, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { TestCasesDialogs } from "./test-cases-dialogs.tsx";
import { TestCasesPanel } from "./test-cases-panel.tsx";
import { TestCasesRail } from "./test-cases-rail.tsx";
import { useTestCasesTab } from "./use-test-cases-tab.ts";

/** The page header sits right of the rail, so the rail runs full height like every section. */
export function TestCasesTab({ header }: { header?: ReactNode }) {
  const model = useTestCasesTab();
  // An empty project has nothing to file, so its setup prompt takes the whole page.
  const { data } = model;
  const isEmptyProject =
    !data.isLoading && !data.hasAgent && data.suites.length === 0 && data.externalSets.length === 0;

  return (
    <Stack
      direction={{ base: "column", md: "row" }}
      width="full"
      height="full"
      gap={0}
      alignItems="stretch"
      data-testid="agent-testing-cases-tab"
    >
      {!isEmptyProject && <TestCasesRail model={model} />}

      <VStack align="stretch" flex={1} minWidth={0} gap={0}>
        {header}
        <TestCasesPanel model={model} />
      </VStack>

      <TestCasesDialogs model={model} />
    </Stack>
  );
}
