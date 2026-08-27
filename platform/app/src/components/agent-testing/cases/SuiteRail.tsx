/**
 * The rail on the left of the Scenarios tab: the test suites of the project,
 * then the sets that run from code.
 *
 * The rail is a view over what it is given. Every action it offers is a
 * callback, so the reading of the address and the writing of the data both
 * stay in the panel that owns them.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/suites/suite-folders.feature
 */

import { VStack } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import type {
  Period,
  PeriodMode,
  RelativePresetKey,
} from "~/components/PeriodSelector";
import { SuiteArchiveDialog } from "~/components/suites/SuiteArchiveDialog";
import { VoiceAgentsCallout } from "~/components/suites/VoiceAgentsCallout";
import type { AgentTestingSelection } from "../useAgentTestingRouting";
import { SuiteRailFooter } from "./SuiteRailFooter";
import { SuiteRailSections } from "./SuiteRailSections";
import type { ExternalSetEntry, TestSuiteEntry } from "./test-cases";

/** How wide the rail is when it is open. */
export const SUITE_RAIL_WIDTH = 218;

/** What the archive dialog of a test suite says. */
export const SUITE_ARCHIVE_TITLE = "Archive test suite?";
export const SUITE_ARCHIVE_DESCRIPTION =
  "The scenarios in it are archived as well. Test runs are preserved.";

export type SuiteRailProps = {
  /**
   * The suite that is open, already resolved. The address may name none, so
   * the rail marks what the tab actually shows rather than what was asked
   * for.
   */
  selectedSuiteId: string | null;
  /** The set that runs from code that is open, if one is. */
  selectedExternalSetId: string | null;
  suites: TestSuiteEntry[];
  externalSets: ExternalSetEntry[];
  isLoading?: boolean;
  /** False for a person who may read the project but not change it. */
  canManage: boolean;
  /** The suites that have a run to open. */
  suiteIdsWithRuns: ReadonlySet<string>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (selection: AgentTestingSelection) => void;
  /** Asks for the name of a new test suite. */
  onNewSuite: () => void;
  onNewTestCase: (suiteId: string) => void;
  onRunSuite: (suiteId: string) => void;
  onRenameSuite: (suiteId: string) => void;
  onOpenLastRun: (suite: TestSuiteEntry) => void;
  onArchiveSuite: (suiteId: string) => void;
  isArchiving?: boolean;
  period: Period;
  periodMode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (key: RelativePresetKey) => void;
};

export function SuiteRail(props: SuiteRailProps) {
  const { collapsed, onArchiveSuite, isArchiving = false } = props;
  const [suiteToArchive, setSuiteToArchive] = useState<TestSuiteEntry | null>(
    null,
  );

  const handleArchiveConfirm = useCallback(() => {
    if (!suiteToArchive) return;
    onArchiveSuite(suiteToArchive.id);
    setSuiteToArchive(null);
  }, [onArchiveSuite, suiteToArchive]);

  return (
    <VStack
      align="stretch"
      gap={0}
      height="full"
      width={collapsed ? "56px" : `${SUITE_RAIL_WIDTH}px`}
      minWidth={collapsed ? "56px" : `${SUITE_RAIL_WIDTH}px`}
      data-testid="agent-testing-suite-rail"
    >
      <SuiteRailSections {...props} onRequestArchive={setSuiteToArchive} />

      {!collapsed && <VoiceAgentsCallout />}

      <SuiteRailFooter {...props} />

      <SuiteArchiveDialog
        open={!!suiteToArchive}
        onClose={() => setSuiteToArchive(null)}
        onConfirm={handleArchiveConfirm}
        suiteName={suiteToArchive?.name ?? ""}
        isLoading={isArchiving}
        title={SUITE_ARCHIVE_TITLE}
        description={SUITE_ARCHIVE_DESCRIPTION}
      />
    </VStack>
  );
}
