/**
 * The row menu of one test suite in the rail.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { Button } from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import { Menu } from "~/components/ui/menu";
import type { TestSuiteEntry } from "./test-cases";

export type SuiteRailMenuProps = {
  suite: TestSuiteEntry;
  canManage: boolean;
  hasRun: boolean;
  onNewTestCase: (suiteId: string) => void;
  onRunSuite: (suiteId: string) => void;
  onEditSuite: (suiteId: string) => void;
  onOpenLastRun: (suite: TestSuiteEntry) => void;
  onArchiveSuite: () => void;
};

export function SuiteRailMenu({
  suite,
  canManage,
  hasRun,
  onNewTestCase,
  onRunSuite,
  onEditSuite,
  onOpenLastRun,
  onArchiveSuite,
}: SuiteRailMenuProps) {
  const stop = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          aria-label={`Actions for ${suite.name}`}
          onClick={stop}
        >
          <MoreVertical size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        {canManage && (
          <Menu.Item
            value="new-test-case"
            onClick={(event) => {
              stop(event);
              onNewTestCase(suite.id);
            }}
          >
            New test case
          </Menu.Item>
        )}
        {canManage && (
          <Menu.Item
            value="run-suite"
            onClick={(event) => {
              stop(event);
              onRunSuite(suite.id);
            }}
          >
            Run suite
          </Menu.Item>
        )}
        {canManage && (
          <Menu.Item
            value="edit-suite"
            onClick={(event) => {
              stop(event);
              onEditSuite(suite.id);
            }}
          >
            Edit suite
          </Menu.Item>
        )}
        {hasRun && (
          <Menu.Item
            value="open-last-run"
            onClick={(event) => {
              stop(event);
              onOpenLastRun(suite);
            }}
          >
            Open last run
          </Menu.Item>
        )}
        {canManage && (
          <Menu.Item
            value="archive-suite"
            color="orange.500"
            onClick={(event) => {
              stop(event);
              onArchiveSuite();
            }}
          >
            Archive suite
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}
