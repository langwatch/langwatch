/**
 * The line above the cases table: what is selected, how many cases it holds,
 * the label filter and the two entry points that write.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { Badge, Button, HStack, Spacer, Text } from "@chakra-ui/react";
import { FolderCode, Play, Plus } from "lucide-react";
import { LabelFilterDropdown } from "~/components/scenarios/LabelFilterDropdown";
import type { CasesPanelProps } from "./CasesPanel";

export type CasesPanelHeaderProps = Pick<
  CasesPanelProps,
  | "selection"
  | "title"
  | "canManage"
  | "allLabels"
  | "activeLabels"
  | "onToggleLabel"
  | "isRunningSet"
  | "onRunSet"
  | "onNewTestCase"
> & {
  /** True for a set that runs from code, which the platform cannot write. */
  isExternal: boolean;
  caseCount: number;
};

export function CasesPanelHeader(props: CasesPanelHeaderProps) {
  return (
    <HStack gap={2}>
      {props.isExternal && (
        <FolderCode size={16} color="var(--chakra-colors-fg-muted)" />
      )}
      <Text fontSize="sm" fontWeight="semibold">
        {props.title}
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {props.caseCount === 1
          ? "1 test case"
          : `${props.caseCount} test cases`}
      </Text>
      {props.isExternal && (
        <Badge size="xs" variant="subtle" colorPalette="gray">
          from code
        </Badge>
      )}
      <Spacer />
      {!props.isExternal && props.allLabels.length > 0 && (
        <LabelFilterDropdown
          allLabels={props.allLabels}
          activeLabels={props.activeLabels}
          onToggle={props.onToggleLabel}
        />
      )}
      {!props.isExternal && props.canManage && <CasesPanelActions {...props} />}
    </HStack>
  );
}

/** The write entry points, offered only on a set the platform owns. */
function CasesPanelActions({
  selection,
  isRunningSet,
  onRunSet,
  onNewTestCase,
}: Pick<
  CasesPanelHeaderProps,
  "selection" | "isRunningSet" | "onRunSet" | "onNewTestCase"
>) {
  return (
    <>
      <Button size="sm" variant="outline" onClick={onNewTestCase}>
        <Plus size={14} />
        New test case
      </Button>
      <Button
        size="sm"
        variant="outline"
        loading={isRunningSet}
        onClick={onRunSet}
      >
        <Play size={14} />
        {selection.kind === "all" ? "Run all" : "Run suite"}
      </Button>
    </>
  );
}
