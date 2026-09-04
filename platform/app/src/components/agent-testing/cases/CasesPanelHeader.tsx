/**
 * The lines above the scenarios table: the suite that is open, what it
 * holds, the label filter and the entry points that write; and under them
 * the fields and the evaluators the suite declares, when it declares any.
 *
 * The way into a recent run sits here too, between "Edit suite" and "Run
 * suite", so writing a scenario, editing the suite, reading what the suite
 * already did and running it again are one row of controls.
 *
 * A set that runs from code is read-only, so it offers the recent runs and
 * nothing else. Its results stay one click away: a row of the table opens
 * them as well.
 *
 * @see specs/features/agent-testing/cases-table.feature
 * @see specs/features/agent-testing/suite-editor.feature
 */

import { HStack, Icon, Spacer, Text, VStack } from "@chakra-ui/react";
import { Folder, FolderCode, Pencil, Play, Plus } from "lucide-react";
import { LabelFilterDropdown } from "~/components/scenarios/LabelFilterDropdown";
import { FG_MUTED } from "../shared/design";
import { FromCodeBadge } from "../shared/FromCodeBadge";
import { SmallButton } from "../shared/SmallButton";
import {
  declarationsCountLine,
  SuiteDeclarationsRow,
} from "../suite/SuiteDeclarationsRow";
import type { CasesPanelProps } from "./CasesPanel";
import { RecentRunsMenu } from "./RecentRunsMenu";

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
  | "onEditSuite"
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
      <Text fontSize="14px" fontWeight="semibold" color="fg" truncate>
        {props.title}
      </Text>
      <Text
        fontSize="11.5px"
        color={FG_MUTED}
        data-testid="cases-panel-count-line"
      >
        {declarationsCountLine({
          caseCount: props.caseCount,
          fieldCount: props.suite?.fields.length ?? 0,
          evaluatorCount: props.suite?.evaluators.length ?? 0,
        })}
      </Text>
      {props.isExternal && <FromCodeBadge />}
    </>
  );
}

export function CasesPanelHeader(props: CasesPanelHeaderProps) {
  // Day zero has no suite to name, so the header stays out of the way and the
  // body asks the one question there is to ask.
  if (!props.isExternal && !props.suite) return null;

  const canWrite = props.canManage && !props.isExternal;

  return (
    <VStack align="stretch" gap={1.5}>
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
            <SmallButton
              onClick={() => props.onEditSuite()}
              data-testid="edit-suite-button"
            >
              <Pencil size={13} />
              Edit suite
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
      {props.suite && !props.isExternal && (
        <SuiteDeclarationsRow
          fields={props.suite.fields}
          evaluators={props.suite.evaluators}
          onEdit={canWrite ? props.onEditSuite : undefined}
        />
      )}
    </VStack>
  );
}
