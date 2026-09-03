/**
 * The row menu of one test suite in the rail.
 *
 * The recent runs of the suite hang off it as a submenu, holding the same runs
 * the button above the table holds, narrowed to the scenarios of this suite.
 *
 * Every action carries the icon it carries in the scenario row menu, so the
 * same action reads the same way wherever the tab offers it.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 * @see dev/docs/best_practices/row-actions-overflow-menu.md
 */

import { Button } from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import { Menu } from "@langwatch/design-system/menu";
import type { TestSuiteEntry } from "../../../../model/agent-testing/cases/test-cases";
import type { Period } from "@langwatch/analytics-web/components/PeriodSelector";
import {
  MenuActionLabel,
  type MenuActionName,
} from "../../../sections/agent-testing/cases/menu-action-label";
import { RecentRunsSubmenu } from "../../../sections/agent-testing/cases/recent-runs-menu";

export type SuiteRailMenuProps = {
  suite: TestSuiteEntry;
  canManage: boolean;
  hasRun: boolean;
  /** The window the recent runs of the suite are read over. */
  period: Period;
  /** The scenarios filed under the suite, which are what its runs covered. */
  scenarioIds: string[];
  onNewTestCase: (suiteId: string) => void;
  onRunSuite: (suiteId: string) => void;
  onRenameSuite: (suiteId: string) => void;
  onArchiveSuite: () => void;
};

const stop = (event: React.MouseEvent) => event.stopPropagation();

/**
 * The menu only appears under the pointer, so a rail of suites reads as a
 * list of names and not as a column of controls.
 */
function MenuTrigger({ suiteName, ...rest }: { suiteName: string }) {
  return (
    <Button
      size="xs"
      variant="ghost"
      minWidth="20px"
      height="20px"
      paddingX={0}
      opacity={0}
      _groupHover={{ opacity: 1 }}
      _focusVisible={{ opacity: 1 }}
      _open={{ opacity: 1 }}
      aria-label={`Actions for ${suiteName}`}
      onClick={stop}
      {...rest}
    >
      <MoreVertical size={13} />
    </Button>
  );
}

/** One action of the menu, with the click kept off the row behind it. */
function SuiteMenuItem({
  value,
  action,
  color,
  onChoose,
  children,
}: {
  value: string;
  action: MenuActionName;
  color?: string;
  onChoose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Menu.Item
      value={value}
      color={color}
      onClick={(event) => {
        stop(event);
        onChoose();
      }}
    >
      <MenuActionLabel action={action}>{children}</MenuActionLabel>
    </Menu.Item>
  );
}

export function SuiteRailMenu({
  suite,
  canManage,
  hasRun,
  period,
  scenarioIds,
  onNewTestCase,
  onRunSuite,
  onRenameSuite,
  onArchiveSuite,
}: SuiteRailMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <MenuTrigger suiteName={suite.name} />
      </Menu.Trigger>
      <Menu.Content>
        {canManage && (
          <SuiteMenuItem
            value="new-test-case"
            action="newScenario"
            onChoose={() => onNewTestCase(suite.id)}
          >
            New scenario
          </SuiteMenuItem>
        )}
        {canManage && (
          <SuiteMenuItem value="run-suite" action="runSuite" onChoose={() => onRunSuite(suite.id)}>
            Run suite
          </SuiteMenuItem>
        )}
        {canManage && (
          <SuiteMenuItem
            value="rename-suite"
            action="rename"
            onChoose={() => onRenameSuite(suite.id)}
          >
            Rename
          </SuiteMenuItem>
        )}
        {hasRun && <RecentRunsSubmenu period={period} scenarioIds={scenarioIds} />}
        {canManage && (
          <SuiteMenuItem
            value="archive-suite"
            action="archive"
            color="red.600"
            onChoose={() => onArchiveSuite()}
          >
            Archive suite
          </SuiteMenuItem>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}
