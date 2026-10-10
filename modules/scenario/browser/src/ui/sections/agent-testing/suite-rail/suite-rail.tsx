/**
 * The rail on the left of Scenarios: the project's suites, then the sets that run from code.
 * It is the shared section rail, so its title, entries, current chip and glass match the
 * other sections; each entry is a link to its own address.
 * @see specs/features/agent-testing/suites-rail.feature
 * @see specs/suites/test-suites.feature
 */
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { Box, Icon, Skeleton, VStack } from "@langwatch/design-system/primitives";
import {
  SECTION_RAIL_WIDTH,
  SectionNavigationRail,
  type SectionNavigationLink,
} from "@langwatch/design-system/section-navigation-frame";
import type { Instant } from "@langwatch/time";
import { Folder, FolderCode } from "lucide-react";
import { useState } from "react";

import {
  buildAgentTestingPush,
  type AgentTestingSelection,
} from "../../../../behavior/agent-testing/use-agent-testing-routing.ts";
import type {
  ExternalSetEntry,
  TestSuiteEntry,
} from "../../../../model/agent-testing/cases/test-cases.ts";
import { FG_MUTED } from "../../../../model/agent-testing/shared/design.ts";
import type { Period, PeriodMode, RelativePresetKey } from "../../../../model/analytics/period.ts";
import { SuiteArchiveDialog } from "../../../elements/suite/dialogs/suite-archive-dialog.tsx";
import type { SuiteLastRun } from "../cases/use-test-cases-data.ts";
import { SuiteRailFooter } from "./suite-rail-footer.tsx";
import { SuiteRailMenu } from "./suite-rail-menu.tsx";

/** How wide the rail is when it is open: the shared section rail's width. */
export const SUITE_RAIL_WIDTH = SECTION_RAIL_WIDTH;

/** What the section of the sets a code run writes into is called. */
export const FROM_CODE_HEADING = "From Code";

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
  /** The last run of every suite that has one, keyed by suite id. */
  lastRunBySuiteId: ReadonlyMap<string, SuiteLastRun>;
  /** The scenarios filed under every suite, which its recent runs are read from. */
  scenarioIdsBySuiteId: ReadonlyMap<string, string[]>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (selection: AgentTestingSelection) => void;
  /** Asks for the name of a new test suite. */
  onNewSuite: () => void;
  onNewTestCase: (suiteId: string) => void;
  onRunSuite: (suiteId: string) => void;
  /** Opens the suite editor on one suite. */
  onEditSuite: (suiteId: string) => void;
  onArchiveSuite: (suiteId: string) => void;
  isArchiving?: boolean;
  period: Period;
  periodMode: PeriodMode;
  setPeriod: (startDate: Instant, endDate: Instant) => void;
  setRelativePeriod: (key: RelativePresetKey) => void;
};

type RailEntry = { selection: AgentTestingSelection; link: SectionNavigationLink };

export function SuiteRail(props: SuiteRailProps) {
  const { collapsed, canManage, isArchiving = false } = props;
  const { project } = useOrganizationTeamProject();
  const [suiteToArchive, setSuiteToArchive] = useState<TestSuiteEntry | null>(null);

  const hrefOf = (selection: AgentTestingSelection) =>
    buildAgentTestingPush({
      projectSlug: project?.slug ?? "",
      state: { tab: "cases", selection, planSlug: null, batchRunId: null },
      query: {},
    });
  const iconOf = (as: typeof Folder, label?: string) => (
    <Icon as={as} boxSize="14px" color={FG_MUTED} flexShrink={0} aria-label={label} />
  );

  const suiteEntries: RailEntry[] = props.isLoading
    ? []
    : props.suites.map((suite) => {
        const selection: AgentTestingSelection = { kind: "suite", slug: suite.slug };
        return {
          selection,
          link: {
            label: suite.name,
            href: hrefOf(selection),
            icon: iconOf(Folder),
            testId: `suite-rail-item-${suite.name}`,
            actions: (
              <SuiteRailMenu
                suite={suite}
                canManage={canManage}
                hasRun={props.lastRunBySuiteId.has(suite.id)}
                period={props.period}
                scenarioIds={props.scenarioIdsBySuiteId.get(suite.id) ?? []}
                onNewTestCase={props.onNewTestCase}
                onRunSuite={props.onRunSuite}
                onEditSuite={props.onEditSuite}
                onArchiveSuite={() => setSuiteToArchive(suite)}
              />
            ),
          },
        };
      });
  const externalEntries: RailEntry[] = props.externalSets.map((set) => {
    const selection: AgentTestingSelection = { kind: "external", setId: set.setId };
    return {
      selection,
      link: {
        label: set.setId,
        href: hrefOf(selection),
        icon: iconOf(FolderCode, "Runs from code"),
        testId: `suite-rail-item-${set.setId}`,
      },
    };
  });
  const entries = [...suiteEntries, ...externalEntries];

  const selectedSuite = props.suites.find((suite) => suite.id === props.selectedSuiteId);
  let activeHref = "";
  if (props.selectedExternalSetId) {
    activeHref = hrefOf({ kind: "external", setId: props.selectedExternalSetId });
  } else if (selectedSuite) {
    activeHref = hrefOf({ kind: "suite", slug: selectedSuite.slug });
  }

  const loadingRows = props.isLoading ? (
    <VStack align="stretch" gap={1} paddingX={1}>
      <Skeleton height="28px" />
      <Skeleton height="28px" />
    </VStack>
  ) : undefined;
  const newSuite = canManage
    ? { label: "New Test Suite", onClick: props.onNewSuite, testId: "agent-testing-rail-new-suite" }
    : undefined;

  return (
    <Box data-testid="agent-testing-suite-rail" display="flex" flexShrink={0}>
      <SectionNavigationRail
        label="Test Suites"
        groups={[
          { links: suiteEntries.map((entry) => entry.link), extra: loadingRows, add: newSuite },
          { label: FROM_CODE_HEADING, links: externalEntries.map((entry) => entry.link) },
        ]}
        activeHref={activeHref}
        onNavigate={(href) => {
          const entry = entries.find((candidate) => candidate.link.href === href);
          if (entry) props.onSelect(entry.selection);
        }}
        collapsed={collapsed}
        footer={<SuiteRailFooter {...props} />}
      />

      <SuiteArchiveDialog
        open={!!suiteToArchive}
        onClose={() => setSuiteToArchive(null)}
        onConfirm={() => {
          if (!suiteToArchive) return;
          props.onArchiveSuite(suiteToArchive.id);
          setSuiteToArchive(null);
        }}
        suiteName={suiteToArchive?.name ?? ""}
        isLoading={isArchiving}
        title={SUITE_ARCHIVE_TITLE}
        description={SUITE_ARCHIVE_DESCRIPTION}
      />
    </Box>
  );
}
