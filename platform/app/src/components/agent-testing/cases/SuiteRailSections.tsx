/**
 * The scrolling body of the suites rail: the test suites of the project, then
 * the sets that run from code.
 *
 * Both headings are plain labels. There is no root list of suites to open, so
 * a heading has nowhere to lead.
 *
 * No row carries a count or a time. How many cases a set holds reads once,
 * beside the title of the panel.
 *
 * @see specs/features/agent-testing/suites-rail.feature
 */

import { Icon, Skeleton, VStack } from "@chakra-ui/react";
import { Folder, FolderCode, FolderPlus } from "lucide-react";
import { FG_MUTED } from "../shared/design";
import type { SuiteRailProps } from "./SuiteRail";
import { RailAddButton, RailItem, RailSectionHeading } from "./SuiteRailItem";
import { SuiteRailMenu } from "./SuiteRailMenu";
import type { TestSuiteEntry } from "./test-cases";

/** What the section of the sets a code run writes into is called. */
export const FROM_CODE_HEADING = "From Code";

export type SuiteRailSectionsProps = Omit<
  SuiteRailProps,
  "onArchiveSuite" | "isArchiving" | "period" | "periodMode"
> & {
  /** Asks for the archive confirmation of one suite. */
  onRequestArchive: (suite: TestSuiteEntry) => void;
};

export function SuiteRailSections(props: SuiteRailSectionsProps) {
  const { collapsed, canManage } = props;

  return (
    <VStack
      align="stretch"
      gap={0.5}
      flex={1}
      overflowY="auto"
      paddingX={3}
      paddingY={4}
    >
      <RailSectionHeading collapsed={collapsed} label="Test Suites" />

      <SuiteRailSuiteList {...props} />

      {canManage && !collapsed && (
        <RailAddButton
          label="New Test Suite"
          icon={<Icon as={FolderPlus} boxSize="13px" />}
          onClick={props.onNewSuite}
        />
      )}

      <SuiteRailExternalSets {...props} />
    </VStack>
  );
}

/** The rows of the test suites, or the skeleton that stands in for them. */
function SuiteRailSuiteList(props: SuiteRailSectionsProps) {
  const { selectedSuiteId, suites, collapsed, canManage, onSelect } = props;

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
          icon={
            <Icon as={Folder} boxSize="13px" color={FG_MUTED} flexShrink={0} />
          }
          selected={selectedSuiteId === suite.id}
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
                onRenameSuite={props.onRenameSuite}
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
  const { selectedExternalSetId, externalSets, collapsed, onSelect } = props;

  if (externalSets.length === 0) return null;

  return (
    <>
      <RailSectionHeading
        collapsed={collapsed}
        label={FROM_CODE_HEADING}
        spaced
      />
      {externalSets.map((set) => (
        <RailItem
          key={set.setId}
          label={set.setId}
          icon={
            <Icon
              as={FolderCode}
              boxSize="13px"
              color={FG_MUTED}
              flexShrink={0}
              aria-label="Runs from code"
            />
          }
          selected={selectedExternalSetId === set.setId}
          collapsed={collapsed}
          onClick={() => onSelect({ kind: "external", setId: set.setId })}
        />
      ))}
    </>
  );
}
