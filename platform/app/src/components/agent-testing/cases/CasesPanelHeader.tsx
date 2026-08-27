/**
 * The line above the cases table: the suite that is open, how many cases it
 * holds, the label filter and the entry points that write.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { Badge, HStack, Icon, Spacer, Text } from "@chakra-ui/react";
import { ChevronRight, Folder, FolderCode, Pencil, Play, Plus } from "lucide-react";
import { LabelFilterDropdown } from "~/components/scenarios/LabelFilterDropdown";
import { FG_MUTED } from "../shared/design";
import { SmallButton } from "../shared/SmallButton";
import type { CasesPanelProps } from "./CasesPanel";

export type CasesPanelHeaderProps = Pick<
  CasesPanelProps,
  | "title"
  | "canManage"
  | "hasSuite"
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
  // Day zero has no suite to name, so the header stays out of the way and the
  // body asks the one question there is to ask.
  if (!props.isExternal && !props.hasSuite) return null;

  return (
    <HStack gap={2} minHeight="32px" flexWrap="wrap">
      <Icon
        as={props.isExternal ? FolderCode : Folder}
        boxSize="15px"
        color={FG_MUTED}
      />
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
        props.canManage && <CasesPanelActions {...props} />
      )}
    </HStack>
  );
}

/** The write entry points, offered only on a suite the platform owns. */
function CasesPanelActions({
  isRunningSet,
  onRunSet,
  onNewTestCase,
  onEditSuite,
  allLabels,
  activeLabels,
  onToggleLabel,
}: Pick<
  CasesPanelHeaderProps,
  | "isRunningSet"
  | "onRunSet"
  | "onNewTestCase"
  | "onEditSuite"
  | "allLabels"
  | "activeLabels"
  | "onToggleLabel"
>) {
  return (
    <>
      <SmallButton
        variant="ghost"
        background="transparent"
        borderColor="transparent"
        onClick={onEditSuite}
      >
        <Pencil size={13} />
        Edit suite
      </SmallButton>
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
        Run suite
      </SmallButton>
    </>
  );
}
