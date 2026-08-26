/**
 * The line above the cases table: what is selected, how many cases it holds,
 * the label filter and the entry points that write.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { Badge, HStack, Icon, Spacer, Text } from "@chakra-ui/react";
import {
  ChevronRight,
  Folder,
  FolderCode,
  Pencil,
  Play,
  Plus,
} from "lucide-react";
import { LabelFilterDropdown } from "~/components/scenarios/LabelFilterDropdown";
import { FG_MUTED } from "../shared/design";
import { SmallButton } from "../shared/SmallButton";
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
  | "onEditSuite"
  | "onOpenExternalResults"
> & {
  /** True for a set that runs from code, which the platform cannot write. */
  isExternal: boolean;
  caseCount: number;
};

export function CasesPanelHeader(props: CasesPanelHeaderProps) {
  const isSuite = props.selection.kind === "suite";

  return (
    <HStack gap={2} minHeight="32px" flexWrap="wrap">
      {props.isExternal && (
        <Icon as={FolderCode} boxSize="15px" color={FG_MUTED} />
      )}
      {isSuite && <Icon as={Folder} boxSize="15px" color={FG_MUTED} />}
      <Text fontSize="14px" fontWeight="semibold" color="fg">
        {props.title}
      </Text>
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
      <Spacer />
      {props.isExternal ? (
        <SmallButton onClick={props.onOpenExternalResults}>
          <ChevronRight size={13} />
          View results
        </SmallButton>
      ) : (
        props.canManage && (
          <CasesPanelActions
            {...props}
            allLabels={props.allLabels}
            activeLabels={props.activeLabels}
            onToggleLabel={props.onToggleLabel}
          />
        )
      )}
    </HStack>
  );
}

/** The write entry points, offered only on a set the platform owns. */
function CasesPanelActions({
  selection,
  isRunningSet,
  onRunSet,
  onNewTestCase,
  onEditSuite,
  allLabels,
  activeLabels,
  onToggleLabel,
}: Pick<
  CasesPanelHeaderProps,
  | "selection"
  | "isRunningSet"
  | "onRunSet"
  | "onNewTestCase"
  | "onEditSuite"
  | "allLabels"
  | "activeLabels"
  | "onToggleLabel"
>) {
  const isSuite = selection.kind === "suite";

  return (
    <>
      {isSuite && (
        <SmallButton
          variant="ghost"
          background="transparent"
          borderColor="transparent"
          onClick={onEditSuite}
        >
          <Pencil size={13} />
          Edit suite
        </SmallButton>
      )}
      {allLabels.length > 0 && (
        <LabelFilterDropdown
          allLabels={allLabels}
          activeLabels={activeLabels}
          onToggle={onToggleLabel}
        />
      )}
      <SmallButton onClick={onNewTestCase}>
        <Plus size={13} />
        New scenario
      </SmallButton>
      <SmallButton loading={isRunningSet} onClick={onRunSet}>
        <Play size={13} />
        {isSuite ? "Run suite" : "Run all"}
      </SmallButton>
    </>
  );
}
