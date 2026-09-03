/**
 * Every way the Scenarios tab opens one scenario: the editor drawer, whether it
 * is reached from the row menu or from the row itself. The versions of a
 * scenario read inside the editor drawer, and its runs hang off the row menu as
 * a submenu of their own.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see dev/docs/best_practices/drawers.md
 */

import { useCallback } from "react";
import type { TestCase } from "../../../../model/agent-testing/cases/test-cases";
import { useDrawer } from "@langwatch/ui-drawer";
import { CASE_EDITOR_DRAWER } from "./agent-testing-case-editor-drawer";

export type CaseOpenActions = {
  openEditor: (testCase: TestCase) => void;
  /** A row click always opens the scenario editor. */
  onRowClick: (testCase: TestCase) => void;
};

export function useCaseOpenActions(): CaseOpenActions {
  const { openDrawer } = useDrawer();

  const openEditor = useCallback(
    (testCase: TestCase) => openDrawer(CASE_EDITOR_DRAWER, { scenarioId: testCase.id }),
    [openDrawer],
  );

  // A row click opens the scenario editor pre-scoped to the test suite it sits in, so
  // a new derivative of the scenario would file under the same suite.
  const onRowClick = useCallback(
    (testCase: TestCase) =>
      openDrawer(CASE_EDITOR_DRAWER, {
        scenarioId: testCase.id,
        testSuiteId: testCase.testSuiteId ?? undefined,
      }),
    [openDrawer],
  );

  return { openEditor, onRowClick };
}
