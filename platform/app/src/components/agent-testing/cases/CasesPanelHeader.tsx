/**
 * The line above the cases table: the suite that is open, how many scenarios
 * it holds, the label filter and the entry points that write.
 *
 * The way into a recent run sits here too, between "New scenario" and
 * "Run suite", so writing a scenario, reading what the suite already did and
 * running it again are one row of controls.
 *
 * A set that runs from code is read-only, so it offers the recent runs and
 * nothing else. Its results stay one click away: a row of the table opens
 * them as well.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { Badge, HStack, Icon, Spacer, Text } from "@chakra-ui/react";
import { Folder, FolderCode, Play, Plus } from "lucide-react";
import { LabelFilterDropdown } from "~/components/scenarios/LabelFilterDropdown";
import { FG_MUTED } from "../shared/design";
import { SmallButton } from "../shared/SmallButton";
import type { CasesPanelProps } from "./CasesPanel";
import { RecentRunsMenu } from "./RecentRunsMenu";
import { SuiteNameHeading } from "./SuiteNameHeading";

export type CasesPanelHeaderProps = Pick<
  CasesPanelProps,
  | "title"
  | "canManage"
  | "suite"
  | "allLabels"
  | "activeLabels"
  | "onToggleLabel"
  | "isRunningSet"
  | "onRunSet"
  | "onNewTestCase"
  | "onRenameSuite"
  | "period"
  | "suiteScenarioIds"
  | "externalCases"
  | "lastResults"
> & {
  /** True for a set that runs from code, which the platform cannot write. */
  isExternal: boolean;
  caseCount: number;
};

/**
 * The scenarios the recent runs are read for: the whole open suite, or the
 * scenarios a code run wrote into the set.
 */
function recentRunScenarioIds(props: CasesPanelHeaderProps): string[] {
  if (props.isExternal) {
    return props.externalCases.map((externalCase) => externalCase.scenarioId);
  }
  return props.suiteScenarioIds;
}

/**
 * Has a scenario of this set run inside the period, which is the one question
 * the list itself answers. The control is never offered over an empty list.
 *
 * A set that runs from code is listed only because a run wrote it, so its
 * rows are the answer.
 */
function hasRunInPeriod(props: CasesPanelHeaderProps): boolean {
  if (props.isExternal) return props.externalCases.length > 0;
  return props.suiteScenarioIds.some((scenarioId) =>
    props.lastResults.has(scenarioId),
  );
}

/** What the open set is: its icon, its name, how much it holds. */
function CasesPanelIdentity(props: CasesPanelHeaderProps) {
  return (
    <>
      <Icon
        as={props.isExternal ? FolderCode : Folder}
        boxSize="15px"
        color={FG_MUTED}
      />
      <SuiteNameHeading
        name={props.title}
        onRename={
          !props.isExternal && props.canManage ? props.onRenameSuite : undefined
        }
      />
      <Text fontSize="11.5px" color={FG_MUTED}>
        {props.caseCount} {props.caseCount === 1 ? "scenario" : "scenarios"}
      </Text>
      {props.isExternal && (
        <Badge
          size="xs"
          variant="subtle"
          colorPalette="gray"
          title="Defined and run from your codebase; results land here"
        >
          from code
        </Badge>
      )}
    </>
  );
}

export function CasesPanelHeader(props: CasesPanelHeaderProps) {
  // Day zero has no suite to name, so the header stays out of the way and the
  // body asks the one question there is to ask.
  if (!props.isExternal && !props.suite) return null;

  const canWrite = props.canManage && !props.isExternal;

  return (
    <HStack gap={2} minHeight="32px" flexWrap="wrap">
      <CasesPanelIdentity {...props} />
      <Spacer />
      {canWrite && (
        <>
          {props.allLabels.length > 0 && (
            <LabelFilterDropdown
              allLabels={props.allLabels}
              activeLabels={props.activeLabels}
              onToggle={props.onToggleLabel}
            />
          )}
          <SmallButton onClick={props.onNewTestCase}>
            <Plus size={13} />
            New scenario
          </SmallButton>
        </>
      )}
      <RecentRunsMenu
        period={props.period}
        scenarioIds={recentRunScenarioIds(props)}
        hasRun={hasRunInPeriod(props)}
      />
      {canWrite && (
        <SmallButton loading={props.isRunningSet} onClick={props.onRunSet}>
          <Play size={13} />
          Run suite
        </SmallButton>
      )}
    </HStack>
  );
}
