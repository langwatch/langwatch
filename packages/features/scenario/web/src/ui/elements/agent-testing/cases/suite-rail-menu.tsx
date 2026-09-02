/**
 * The row menu of one test suite in the rail.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { Button } from "@chakra-ui/react";
import { MoreVertical } from "lucide-react";
import { Menu } from "@langwatch/design-system/menu";
import type { TestSuiteEntry } from "../../../../model/agent-testing/cases/test-cases";

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
  color,
  onChoose,
  children,
}: {
  value: string;
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
      {children}
    </Menu.Item>
  );
}

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
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <MenuTrigger suiteName={suite.name} />
      </Menu.Trigger>
      <Menu.Content>
        {canManage && (
          <SuiteMenuItem
            value="new-test-case"
            onChoose={() => onNewTestCase(suite.id)}
          >
            New test case
          </SuiteMenuItem>
        )}
        {canManage && (
          <SuiteMenuItem
            value="run-suite"
            onChoose={() => onRunSuite(suite.id)}
          >
            Run suite
          </SuiteMenuItem>
        )}
        {canManage && (
          <SuiteMenuItem
            value="edit-suite"
            onChoose={() => onEditSuite(suite.id)}
          >
            Edit suite
          </SuiteMenuItem>
        )}
        {hasRun && (
          <SuiteMenuItem
            value="open-last-run"
            onChoose={() => onOpenLastRun(suite)}
          >
            Open last run
          </SuiteMenuItem>
        )}
        {canManage && (
          <SuiteMenuItem
            value="archive-suite"
            color="orange.500"
            onChoose={() => onArchiveSuite()}
          >
            Archive suite
          </SuiteMenuItem>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}
