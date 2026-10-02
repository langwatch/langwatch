import { Menu } from "@langwatch/design-system/menu";
import {
  Box,
  Button,
  Circle,
  HStack,
  Icon,
  IconButton,
  Spacer,
  Text,
  keyframes,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { AgentTypeEnum } from "@langwatch/experiment-contract";
import {
  computeComparisonColumnTargetAggregate,
  computeComparisonTargetAggregate,
  computeTargetAggregates,
  isRowEmpty,
  countCellsForTarget,
  toComparisonConfig,
  disambiguateNames,
} from "@langwatch/experiment-contract";
import { targetHasMissingMappings } from "@langwatch/experiment-contract/mapping-validation";
import { transposeColumnsFirstToRowsFirstWithId } from "@langwatch/workflow-contract";
import { Bot, Swords, Trophy } from "lucide-react";
import { memo, useMemo, useState } from "react";
import {
  LuArrowLeftRight,
  LuChevronDown,
  LuCircleAlert,
  LuCircleCheck,
  LuCode,
  LuCopy,
  LuFileText,
  LuGlobe,
  LuPencil,
  LuPlay,
  LuSparkles,
  LuSquare,
  LuTrash2,
  LuWorkflow,
} from "react-icons/lu";

import { useEvaluationsV3Store } from "../../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import { useLatestPromptVersion } from "../../../../behavior/experiments-v3/use-latest-prompt-version.ts";
import { usePromptTemplateFields } from "../../../../behavior/experiments-v3/use-prompt-template-fields.ts";
import {
  useTargetName,
  useTargetNames,
} from "../../../../behavior/experiments-v3/use-target-name.ts";
import { TARGET_MISSING_MAPPING_TOOLTIP } from "../../../../model/experiments-v3/constants.ts";
import type {
  ComparisonEvaluatorConfig,
  DatasetReference,
  TargetConfig,
} from "../../../../model/experiments-v3/types.ts";
import { isComparisonEvaluator } from "../../../../model/experiments-v3/types.ts";
import { ComparisonScoreboard } from "../../../elements/experiments-v3/TargetSection/comparison-scoreboard.tsx";
import { VersionBadge } from "../../../elements/prompt/version-badge.tsx";
import { ColorfulBlockIcon } from "../../../elements/workflow/workflow-icons.tsx";
import { TargetSummary } from "./target-summary.tsx";

/**
 * The icon a column header shows per agent type.
 */
type IconType = React.ComponentType<{ size?: number }>;

const AGENT_TYPE_ICONS: Record<AgentTypeEnum, { testId: string; icon: IconType }> = {
  code: { testId: "icon-code", icon: LuCode },
  signature: { testId: "icon-code", icon: LuCode },
  http: { testId: "icon-globe", icon: LuGlobe },
  workflow: { testId: "icon-workflow", icon: LuWorkflow },
  connected: { testId: "icon-connected", icon: Bot },
};

// Pulsing animation for missing mapping alert
const pulseAnimation = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
`;

function targetTypeNoun(type: TargetConfig["type"]): string {
  if (type === "prompt") return "Prompt";
  if (type === "evaluator") return "Evaluator";
  return "Agent";
}

function runButtonTooltip({
  isRunning,
  hasMissingMappings,
}: {
  isRunning: boolean;
  hasMissingMappings: boolean;
}): string {
  if (isRunning) return "Stop evaluation";
  if (hasMissingMappings) return "Configure missing mappings first";
  return "Run evaluation";
}

type TargetHeaderProps = {
  target: TargetConfig;
  /** Hands the prompt to Langy for the improvement loop. Prompt targets only. */
  onOptimize?: ({ target, name }: { target: TargetConfig; name: string }) => void;
  onEdit?: (target: TargetConfig) => void;
  onDuplicate?: (target: TargetConfig) => void;
  onSwitch?: (target: TargetConfig) => void;
  onRemove?: (targetId: string) => void;
  onRun?: (target: TargetConfig) => void;
  onStop?: () => void;
  /** Whether this target is currently being executed */
  isRunning?: boolean;
};

/** Resolves each variant id to its live target row, in the variant's declared order. */
function resolveVariantTargets<T extends { id: string }>(
  variantIds: string[],
  allTargets: T[],
): (T | undefined)[] {
  return variantIds.map((id) => allTargets.find((t) => t.id === id));
}

/** Whether a target carries an unsaved prompt or evaluator draft. */
const hasUnpublishedDraft = (target: TargetConfig | undefined): boolean =>
  (target?.type === "prompt" && !!target.localPromptConfig) ||
  (target?.type === "evaluator" && !!target.localEvaluatorConfig);

/**
 * The rows a target's header counts: an inline dataset's non-empty rows, a saved
 * one's loaded records, or (before those load, after a refresh) the persisted outputs.
 */
const nonEmptyRowCountOf = ({
  activeDataset,
  targetOutputs,
}: {
  activeDataset: DatasetReference | undefined;
  targetOutputs: unknown[] | undefined;
}): number => {
  if (activeDataset?.type === "inline" && activeDataset.inline?.records) {
    const rows = transposeColumnsFirstToRowsFirstWithId(activeDataset.inline.records);
    return rows.filter((row: Record<string, unknown>) => !isRowEmpty(row)).length;
  }
  if (activeDataset?.type === "saved" && activeDataset.savedRecords) {
    return activeDataset.savedRecords.length;
  }
  return targetOutputs?.length ?? 0;
};

/**
 * The header's summary numbers over the rows that count. While this target runs,
 * that is only its executing cells, so a one-cell run shows 0/1 rather than 0/N.
 */
const useTargetHeaderAggregates = ({
  target,
  targetComparison,
  isRunning,
}: {
  target: TargetConfig;
  targetComparison: ComparisonEvaluatorConfig | undefined;
  isRunning: boolean;
}) => {
  const { results, evaluators, activeDataset } = useEvaluationsV3Store((state) => ({
    results: state.results,
    evaluators: state.evaluators,
    activeDataset: state.datasets.find((d) => d.id === state.activeDatasetId),
  }));
  const nonEmptyRowCount = useMemo(
    () => nonEmptyRowCountOf({ activeDataset, targetOutputs: results.targetOutputs[target.id] }),
    [activeDataset, results.targetOutputs, target.id],
  );
  const executingCount =
    results.executingCells && isRunning
      ? countCellsForTarget(results.executingCells, target.id, nonEmptyRowCount)
      : 0;
  const effectiveRowCount = executingCount > 0 ? executingCount : nonEmptyRowCount;

  const aggregates = useMemo(
    () =>
      target.type === "evaluator" && targetComparison
        ? computeComparisonColumnTargetAggregate(
            { id: target.id, comparison: targetComparison },
            results,
            effectiveRowCount,
          )
        : computeTargetAggregates({
            targetId: target.id,
            results,
            evaluators,
            rowCount: effectiveRowCount,
          }),
    [target, targetComparison, results, evaluators, effectiveRowCount],
  );
  const comparisonAggregate = useMemo(
    () =>
      targetComparison
        ? computeComparisonTargetAggregate(target, results, effectiveRowCount)
        : null,
    [target, targetComparison, results, effectiveRowCount],
  );
  // Summarised once there are results, errors, cost, or a run in progress.
  const hasAggregates =
    aggregates.completedRows > 0 ||
    aggregates.errorRows > 0 ||
    aggregates.totalCost !== null ||
    results.status === "running";

  return { aggregates, comparisonAggregate, hasAggregates, evaluators };
};

/** Whether a prompt target is pinned to a version older than its latest. */
const useShowsOlderVersion = (target: TargetConfig): boolean => {
  const isPrompt = target.type === "prompt";
  const { latestVersion } = useLatestPromptVersion({
    configId: isPrompt ? target.promptId : undefined,
    currentVersion: isPrompt ? target.promptVersionNumber : undefined,
    // One instance per always-mounted target column: no live refetch storm (#5585).
    isLiveRefetchEnabled: false,
  });
  return (
    isPrompt &&
    target.promptVersionNumber !== undefined &&
    target.promptVersionNumber !== latestVersion
  );
};

/** The header's accent: purple for a comparison, green for prompts and evaluators, else cyan. */
const targetColorOf = (target: TargetConfig): string => {
  if (target.type === "evaluator" && isComparisonEvaluator(target)) return "purple.emphasized";
  if (target.type === "prompt" || target.type === "evaluator") return "green.emphasized";
  return "cyan.emphasized";
};

/**
 * The target's type icon, wrapped so tests can find it (lucide icons drop data-testid).
 * A comparison uses Swords, a workflow the workflow icon, an untyped agent code.
 */
function TargetTypeIcon({ target }: { target: TargetConfig }) {
  const [testId, Icon] = targetIconOf(target);
  return (
    <span data-testid={testId}>
      <Icon size={12} />
    </span>
  );
}

const targetIconOf = (target: TargetConfig): [string, IconType] => {
  if (target.type === "prompt") return ["icon-file", LuFileText];
  if (target.type === "evaluator") {
    return isComparisonEvaluator(target)
      ? ["icon-comparison", Swords]
      : ["icon-evaluator", LuCircleCheck];
  }
  if (target.type === "workflow") return ["icon-workflow", LuWorkflow];
  if (target.type === "agent" && target.agentType) {
    const { testId, icon } = AGENT_TYPE_ICONS[target.agentType];
    return [testId, icon];
  }
  return ["icon-code", LuCode];
};

/**
 * Header component for target columns in the evaluations table. Shows target name with
 * icon, a play button, and a dropdown menu on click.
 */
export const TargetHeader = memo(function TargetHeader({
  target,
  onOptimize,
  onEdit,
  onDuplicate,
  onSwitch,
  onRemove,
  onRun,
  onStop,
  isRunning = false,
}: TargetHeaderProps) {
  // The prop's own draft, or the store's live one for this target.
  const storeHasUnpublished = useEvaluationsV3Store((state) =>
    hasUnpublishedDraft(state.targets.find((r) => r.id === target.id)),
  );
  const hasUnpublishedChanges = hasUnpublishedDraft(target) || storeHasUnpublished;

  // Check if there are missing mappings for the active dataset
  const activeDatasetId = useEvaluationsV3Store((state) => state.activeDatasetId);
  const promptTemplateFields = usePromptTemplateFields();
  const hasMissingMappings = targetHasMissingMappings(target, activeDatasetId, {
    promptTemplateFields,
  });

  // Glows this column's header when a pairwise verdict's variant name was
  // clicked, so users can trace an ambiguous "bot (1)" label back to its
  // source column (customer feedback, 2026-07-08).
  const isHighlightedVariant = useEvaluationsV3Store(
    (state) => state.ui.highlightedVariantTargetId === target.id,
  );

  // When the clicked verdict named this column as its winner, say so
  // explicitly next to the name — the glow alone doesn't tell you whether
  // you traced the winner or a loser.
  const didWin = useEvaluationsV3Store(
    (state) =>
      state.ui.highlightedVariantTargetId === target.id &&
      state.ui.highlightedVariantOutcome === "won",
  );

  // Get the display name for this target
  const targetName = useTargetName(target);

  // For comparison column-targets, resolve every variant's display name so the
  // mini-summary at the right can say "{winner} wins" rather than just "wins",
  // and so the tooltip can break the tally down per variant.
  const targetComparison = useMemo(() => toComparisonConfig(target), [target]);
  const variantIds = targetComparison?.variants;
  const allTargets = useEvaluationsV3Store((state) => state.targets);
  const variantTargets = useMemo(
    () => resolveVariantTargets(variantIds ?? [], allTargets),
    [allTargets, variantIds],
  );

  // Raw names are what the stored verdict label is matched against (the
  // orchestrator emits a prompt's handle); display names additionally number
  // same-name variants so the scoreboard never shows two identical labels.
  const variantNames = useTargetNames(variantTargets);
  const variantDisplayNames = useMemo(
    () =>
      disambiguateNames(
        variantNames.map((name, i) => name || variantIds?.[i] || `Variant ${i + 1}`),
      ),
    [variantNames, variantIds],
  );

  // Two columns can resolve to the same name — duplicating a prompt is the usual way
  // there — leaving the user with two identical headers and no way to tell which is
  // which.
  const allTargetNames = useTargetNames(allTargets);
  const headerName = useMemo(() => {
    const index = allTargets.findIndex((t) => t.id === target.id);
    if (index < 0) return targetName;
    return disambiguateNames(allTargetNames)[index] || targetName;
  }, [allTargets, allTargetNames, target.id, targetName]);

  const { comparisonAggregate, aggregates, hasAggregates, evaluators } = useTargetHeaderAggregates({
    target,
    targetComparison,
    isRunning,
  });

  const showVersionBadge = useShowsOlderVersion(target);

  // Controlled menu state to prevent closing on re-renders
  const [menuOpen, setMenuOpen] = useState(false);

  const editLabel = `Edit ${targetTypeNoun(target.type)}`;

  const switchLabel = `Switch ${targetTypeNoun(target.type)}`;

  const headerRow = (
    <HStack
      data-target-id={target.id}
      gap={2}
      width="full"
      // minWidth=0 allows name to truncate while keeping play button pinned.
      minWidth={0}
      marginY={-2}
      // Glow lives on the <th> itself (evaluations-v3-table.tsx) so the whole
      // column reads as highlighted, not just this inner content row. Keep
      // the marker attribute only, for tests.
      data-testid={isHighlightedVariant ? "target-header-highlighted" : undefined}
    >
      <Menu.Root
        positioning={{ placement: "bottom-start" }}
        open={menuOpen}
        onOpenChange={(e) => setMenuOpen(e.open)}
      >
        <Menu.Trigger asChild>
          <Button
            variant="ghost"
            size="xs"
            _hover={{ bg: "bg.subtle" }}
            paddingX={2}
            paddingY={1}
            gap={2}
            marginX={-2}
            marginY={-2}
            // Absorb the overflow: the name truncates rather than shoving the
            // metrics and play button out of the column.
            minWidth={0}
            flexShrink={1}
            className="group"
            data-testid="target-header-button"
            // The name the reader sees, published for anything that has to
            // refer to this column in words. Every candidate here carries the
            // same prompt handle, so only the disambiguated form tells them
            // apart, and deriving it a second time elsewhere is how the panel
            // ends up naming a different column than the header does.
            data-target-name={headerName}
          >
            <ColorfulBlockIcon
              color={targetColorOf(target)}
              size="xs"
              icon={<TargetTypeIcon target={target} />}
              // Align icon with text for evaluators.
              marginTop={target.type === "evaluator" ? "-2px" : undefined}
            />
            <Text fontSize="13px" fontWeight="medium" truncate>
              {headerName}
            </Text>
            {didWin && (
              <HStack
                gap={1}
                flexShrink={0}
                paddingX={1.5}
                paddingY={0.5}
                borderRadius="sm"
                bg="green.subtle"
                color="green.fg"
                data-testid="target-header-won-badge"
              >
                <Trophy size={10} />
                <Text fontSize="11px" fontWeight="semibold">
                  Won
                </Text>
              </HStack>
            )}
            {showVersionBadge && target.promptVersionNumber !== undefined && (
              <Box flexShrink={0}>
                <VersionBadge version={target.promptVersionNumber} />
              </Box>
            )}
            {hasMissingMappings && (
              <Tooltip
                content={TARGET_MISSING_MAPPING_TOOLTIP}
                positioning={{ placement: "top" }}
                openDelay={0}
                showArrow
              >
                <Box
                  css={{
                    animation: `${pulseAnimation} 2s ease-in-out infinite`,
                  }}
                  flexShrink={0}
                  data-testid="missing-mapping-alert"
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent menu from opening
                    e.preventDefault();
                    setMenuOpen(false); // Close menu if somehow open
                    onEdit?.(target); // Open drawer directly
                  }}
                  cursor="pointer"
                  _hover={{ transform: "scale(1.2)" }}
                  transition="transform 0.15s"
                >
                  <Icon as={LuCircleAlert} color="yellow.fg" boxSize={4} />
                </Box>
              </Tooltip>
            )}
            {hasUnpublishedChanges && !hasMissingMappings && (
              <Tooltip
                content="Unpublished modifications"
                positioning={{ placement: "top" }}
                openDelay={0}
                showArrow
              >
                <Circle
                  size="8px"
                  bg="orange.solid"
                  flexShrink={0}
                  data-testid="unpublished-indicator"
                />
              </Tooltip>
            )}
            <Icon
              as={LuChevronDown}
              width={2.5}
              height={2.5}
              visibility="hidden"
              _groupHover={{ visibility: "visible" }}
            />
          </Button>
        </Menu.Trigger>
        <Menu.Content minWidth="200px">
          {onOptimize && target.type === "prompt" && (
            <Menu.Item
              value="optimize"
              onClick={() => onOptimize({ target, name: headerName })}
              data-testid="target-optimize-menu-item"
            >
              <HStack gap={2}>
                <LuSparkles size={14} />
                <Text>Optimize this prompt</Text>
              </HStack>
            </Menu.Item>
          )}
          <Menu.Item value="edit" onClick={() => onEdit?.(target)}>
            <HStack gap={2}>
              <LuPencil size={14} />
              <Text>{editLabel}</Text>
            </HStack>
          </Menu.Item>
          <Menu.Item value="duplicate" onClick={() => onDuplicate?.(target)}>
            <HStack gap={2}>
              <LuCopy size={14} />
              <Text>Duplicate</Text>
            </HStack>
          </Menu.Item>
          <Menu.Item value="switch" onClick={() => onSwitch?.(target)}>
            <HStack gap={2}>
              <LuArrowLeftRight size={14} />
              <Text>{switchLabel}</Text>
            </HStack>
          </Menu.Item>
          <Box borderTopWidth="1px" borderColor="border" my={1} />
          <Menu.Item value="remove" onClick={() => onRemove?.(target.id)}>
            <HStack gap={2} color="red.fg">
              <LuTrash2 size={14} />
              <Text>Remove from Workbench</Text>
            </HStack>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>

      <Spacer />

      {/* Summary statistics (positioned on the right before play button).
          Comparison columns surface BOTH the "<winner> wins" summary AND
          the shared Rows / Avg Latency / Total Cost / Execution Time
          popover — dogfood ask "I also want the cost metric in pairwise
          compare in v3". Other columns keep the single popover. */}
      {comparisonAggregate && comparisonAggregate.decidedRows > 0 ? (
        // Shrinkable too: a comparison column carries the most header content
        // ("<winner> wins" + latency + cost), and pinning it would push the
        // play button out of the column on a narrow viewport. Only the play
        // button is truly unshrinkable.
        <HStack gap={2} minWidth={0} overflow="hidden">
          <ComparisonScoreboard
            aggregate={comparisonAggregate}
            variantTargets={variantTargets}
            variantNames={variantNames}
            variantDisplayNames={variantDisplayNames}
          />
          {hasAggregates && (
            <TargetSummary aggregates={aggregates} evaluators={evaluators} isRunning={isRunning} />
          )}
        </HStack>
      ) : (
        hasAggregates && (
          <TargetSummary aggregates={aggregates} evaluators={evaluators} isRunning={isRunning} />
        )
      )}

      {/* Play/Stop button on far right */}
      <Tooltip
        content={runButtonTooltip({ isRunning, hasMissingMappings })}
        positioning={{ placement: "top" }}
        openDelay={200}
      >
        <IconButton
          aria-label={isRunning ? "Stop evaluation" : "Run evaluation for this target"}
          size="xs"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            if (isRunning) {
              onStop?.();
            } else if (hasMissingMappings) {
              onEdit?.(target);
            } else {
              onRun?.(target);
            }
          }}
          data-testid="target-play-button"
          minWidth="auto"
          height="auto"
          padding={1}
          // Never let the run button be squeezed out of its own column.
          flexShrink={0}
        >
          {isRunning ? <LuSquare size={14} /> : <LuPlay size={14} />}
        </IconButton>
      </Tooltip>
    </HStack>
  );

  return headerRow;
});
