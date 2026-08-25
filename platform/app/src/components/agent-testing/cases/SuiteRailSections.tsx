/**
 * The scrolling body of the suites rail: All test cases, the test suites of
 * the project, and the sets that run from code.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { IconButton, Skeleton, VStack } from "@chakra-ui/react";
import { Folder, FolderCode, LayoutList, Plus } from "lucide-react";
import { useNow } from "~/hooks/useNow";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import type { SuiteRailProps } from "./SuiteRail";
import { RailItem, RailSectionHeading } from "./SuiteRailItem";
import { SuiteRailMenu } from "./SuiteRailMenu";
import type { TestSuiteEntry } from "./test-cases";

export type SuiteRailSectionsProps = Omit<
  SuiteRailProps,
  "onArchiveSuite" | "isArchiving" | "period" | "periodMode"
> & {
  /** Asks for the new-suite dialog. */
  onNewSuite: () => void;
  /** Asks for the archive confirmation of one suite. */
  onRequestArchive: (suite: TestSuiteEntry) => void;
};

export function SuiteRailSections(props: SuiteRailSectionsProps) {
  const { selection, collapsed, canManage, onSelect } = props;

  return (
    <VStack align="stretch" gap={1} flex={1} overflowY="auto" padding={2}>
      <RailItem
        label="All test cases"
        icon={<LayoutList size={14} color="var(--chakra-colors-fg-muted)" />}
        selected={selection.kind === "all"}
        collapsed={collapsed}
        onClick={() => onSelect({ kind: "all" })}
      />

      <RailSectionHeading
        collapsed={collapsed}
        label="Test Suites"
        action={
          canManage ? (
            <IconButton
              aria-label="New test suite"
              size="xs"
              variant="ghost"
              onClick={props.onNewSuite}
            >
              <Plus size={14} />
            </IconButton>
          ) : null
        }
      />

      <SuiteRailSuiteList {...props} />
      <SuiteRailExternalSets {...props} />
    </VStack>
  );
}

/** The rows of the test suites, or the skeleton that stands in for them. */
function SuiteRailSuiteList(props: SuiteRailSectionsProps) {
  const { selection, suites, collapsed, canManage, onSelect } = props;

  if (props.isLoading) {
    return (
      <VStack align="stretch" gap={1} paddingX={1}>
        <Skeleton height="28px" />
        <Skeleton height="28px" />
      </VStack>
    );
  }

  return (
    <>
      {suites.map((suite) => (
        <RailItem
          key={suite.id}
          label={suite.name}
          icon={<Folder size={14} color="var(--chakra-colors-fg-muted)" />}
          selected={selection.kind === "suite" && selection.slug === suite.slug}
          collapsed={collapsed}
          onClick={() => onSelect({ kind: "suite", slug: suite.slug })}
          actions={
            collapsed ? null : (
              <SuiteRailMenu
                suite={suite}
                canManage={canManage}
                hasRun={props.suiteIdsWithRuns.has(suite.id)}
                onNewTestCase={props.onNewTestCase}
                onRunSuite={props.onRunSuite}
                onEditSuite={props.onEditSuite}
                onOpenLastRun={props.onOpenLastRun}
                onArchiveSuite={() => props.onRequestArchive(suite)}
              />
            )
          }
        />
      ))}
    </>
  );
}

/** The sets a code run writes into, listed under their own heading. */
function SuiteRailExternalSets(props: SuiteRailSectionsProps) {
  const { selection, externalSets, collapsed, onSelect } = props;
  const now = useNow();

  if (externalSets.length === 0) return null;

  return (
    <>
      <RailSectionHeading collapsed={collapsed} label="External Sets" />
      {externalSets.map((set) => (
        <RailItem
          key={set.setId}
          label={set.setId}
          icon={
            <FolderCode
              size={14}
              color="var(--chakra-colors-fg-muted)"
              aria-label="Runs from code"
            />
          }
          caption={
            set.lastRunTimestamp
              ? formatTimeAgoCompact(set.lastRunTimestamp, now)
              : undefined
          }
          selected={
            selection.kind === "external" && selection.setId === set.setId
          }
          collapsed={collapsed}
          onClick={() => onSelect({ kind: "external", setId: set.setId })}
        />
      ))}
    </>
  );
}
