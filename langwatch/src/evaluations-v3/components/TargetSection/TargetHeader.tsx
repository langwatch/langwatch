import {
  Box,
  Button,
  Circle,
  HStack,
  Icon,
  IconButton,
  Spacer,
  Text,
} from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
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
  LuSquare,
  LuTrash2,
} from "react-icons/lu";

import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { ColorfulBlockIcon } from "~/optimization_studio/components/ColorfulBlockIcons";
import { transposeColumnsFirstToRowsFirstWithId } from "~/optimization_studio/utils/datasetUtils";
import { VersionBadge } from "~/prompts/components/ui/VersionBadge";
import { useLatestPromptVersion } from "~/prompts/hooks/useLatestPromptVersion";
import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import { useTargetName } from "../../hooks/useTargetName";
import type { TargetConfig } from "../../types";
import { computeTargetAggregates } from "../../utils/computeAggregates";
import { isRowEmpty } from "../../utils/emptyRowDetection";
import { countCellsForTarget } from "../../utils/executionScope";
import { targetHasMissingMappings } from "../../utils/mappingValidation";
import { TargetSummary } from "./TargetSummary";

// Pulsing animation for missing mapping alert
const pulseAnimation = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
`;

type TargetHeaderProps = {
  target: TargetConfig;
  onEdit?: (target: TargetConfig) => void;
  onDuplicate?: (target: TargetConfig) => void;
  onSwitch?: (target: TargetConfig) => void;
  onRemove?: (targetId: string) => void;
  onRun?: (target: TargetConfig) => void;
  onStop?: () => void;
  /** Whether this target is currently being executed */
  isRunning?: boolean;
};

/**
 * Header component for target columns in the evaluations table.
 * Shows target name with icon, a play button, and a dropdown menu on click.
 *
 * Menu options:
 * - For prompts: "Edit Prompt", "Remove from Workbench"
 * - For agents: "Edit Agent", "Remove from Workbench"
 *
 * Note: For workflow agents, clicking "Edit Agent" opens the workflow in a new tab.
 * This is determined at runtime by fetching the agent data via tRPC.
 *
 * Memoized to prevent unnecessary re-renders when other targets' config changes.
 */
export const TargetHeader = memo(function TargetHeader({
  target,
  onEdit,
  onDuplicate,
  onSwitch,
  onRemove,
  onRun,
  onStop,
  isRunning = false,
}: TargetHeaderProps) {
  // First check if prop has localPromptConfig (for direct prop usage)
  const propHasUnpublished =
    target.type === "prompt" && !!target.localPromptConfig;

  // Subscribe directly to just this target's unpublished state from store
  // This is used when the table passes targets without localPromptConfig in props
  // (e.g., when using useShallow which doesn't deep-compare)
  const storeHasUnpublished = useEvaluationsV3Store((state) => {
    if (target.type !== "prompt") return false;
    const currentTarget = state.targets.find((r) => r.id === target.id);
    return (
      currentTarget?.type === "prompt" && !!currentTarget.localPromptConfig
    );
  });

  // Use prop value if available, otherwise use store value
  const hasUnpublishedChanges = propHasUnpublished || storeHasUnpublished;

  // Check if there are missing mappings for the active dataset
  const activeDatasetId = useEvaluationsV3Store(
    (state) => state.activeDatasetId,
  );
  const hasMissingMappings = targetHasMissingMappings(target, activeDatasetId);

  // Get the display name for this target
  const targetName = useTargetName(target);

  // Get results, evaluators, and dataset for computing aggregates
  const { results, evaluators, activeDataset } = useEvaluationsV3Store(
    (state) => ({
      results: state.results,
      evaluators: state.evaluators,
      activeDataset: state.datasets.find((d) => d.id === state.activeDatasetId),
    }),
  );

  // Count non-empty rows (empty rows are skipped during execution)
  // Handles both inline and saved datasets, with fallback to persisted results
  const nonEmptyRowCount = useMemo(() => {
    // For inline datasets, count non-empty rows
    if (activeDataset?.type === "inline" && activeDataset.inline?.records) {
      const rows = transposeColumnsFirstToRowsFirstWithId(
        activeDataset.inline.records,
      );
      return rows.filter((row: Record<string, unknown>) => !isRowEmpty(row))
        .length;
    }

    // For saved datasets, use savedRecords count when available
    if (activeDataset?.type === "saved" && activeDataset.savedRecords) {
      return activeDataset.savedRecords.length;
    }

    // Fallback: If we have persisted results for this target, use that to infer row count
    // This handles the page refresh scenario where savedRecords hasn't loaded yet
    const targetOutputs = results.targetOutputs[target.id];
    if (targetOutputs && targetOutputs.length > 0) {
      return targetOutputs.length;
    }

    return 0;
  }, [
    activeDataset?.type,
    activeDataset?.inline?.records,
    activeDataset?.savedRecords,
    results.targetOutputs,
    target.id,
  ]);

  // When THIS target is executing, use the count from executingCells
  // This ensures partial executions show correct progress (e.g., 0/1 for single cell)
  const effectiveRowCount = useMemo(() => {
    if (results.executingCells && isRunning) {
      // Count cells being executed for this specific target
      const maxRowIndex = nonEmptyRowCount; // Max possible row index
      const cellCount = countCellsForTarget(
        results.executingCells,
        target.id,
        maxRowIndex,
      );
      // Only use cell count if this target actually has cells executing
      if (cellCount > 0) {
        return cellCount;
      }
    }
    // When not running or no cells for this target, use the full non-empty row count
    return nonEmptyRowCount;
  }, [results.executingCells, isRunning, target.id, nonEmptyRowCount]);

  // Compute aggregate statistics using effective row count
  const aggregates = useMemo(
    () =>
      computeTargetAggregates(
        target.id,
        results,
        evaluators,
        effectiveRowCount,
      ),
    [target.id, results, evaluators, effectiveRowCount],
  );

  // Show aggregates only when we have results or errors or running
  const hasAggregates =
    aggregates.completedRows > 0 ||
    aggregates.errorRows > 0 ||
    aggregates.totalCost !== null ||
    results.status === "running";

  // Get the latest version for this prompt (to determine if target is at "latest")
  const { latestVersion } = useLatestPromptVersion({
    configId: target.type === "prompt" ? target.promptId : undefined,
    currentVersion:
      target.type === "prompt" ? target.promptVersionNumber : undefined,
  });

  // Check if this target is effectively at "latest" version
  // (either has no pinned version, or pinned version matches latest)
  const isAtLatestVersion =
    target.type === "prompt" &&
    (target.promptVersionNumber === undefined ||
      target.promptVersionNumber === latestVersion);

  // Show version badge if:
  // - Has version number defined AND is NOT at latest version
  // Simple rule: if you're pinned to an older version, show the version badge (gray, no upgrade arrow)
  // This helps users see they're working with an older version at a glance
  // Note: We intentionally don't show drift/upgrade on the table. Users pin old versions
  // for comparison. Drift detection is handled in the drawer.
  const showVersionBadge =
    target.type === "prompt" &&
    target.promptVersionNumber !== undefined &&
    !isAtLatestVersion;

  // Controlled menu state to prevent closing on re-renders
  const [menuOpen, setMenuOpen] = useState(false);

  // Determine icon based on target type
  // Note: Lucide icons don't forward data-testid, so we wrap in span for testing
  const getTargetIcon = () => {
    if (target.type === "prompt") {
      return (
        <span data-testid="icon-file">
          <LuFileText size={12} />
        </span>
      );
    }
    if (target.type === "evaluator") {
      return (
        <span data-testid="icon-evaluator">
          <LuCircleCheck size={12} />
        </span>
      );
    }
    // HTTP agents get a Globe icon
    if (target.type === "agent" && target.agentType === "http") {
      return (
        <span data-testid="icon-globe">
          <LuGlobe size={12} />
        </span>
      );
    }
    // Other agents (code, workflow, signature) get Code icon
    return (
      <span data-testid="icon-code">
        <LuCode size={12} />
      </span>
    );
  };

  const getTargetColor = () => {
    if (target.type === "prompt" || target.type === "evaluator") {
      return "green.emphasized";
    }
    return "cyan.emphasized";
  };

  const editLabel =
    target.type === "prompt"
      ? "Edit Prompt"
      : target.type === "evaluator"
        ? "Edit Evaluator"
        : "Edit Agent";

  const switchLabel =
    target.type === "prompt"
      ? "Switch Prompt"
      : target.type === "evaluator"
        ? "Switch Evaluator"
        : "Switch Agent";

  return (
    <HStack gap={2} width="full" marginY={-2}>
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
            className="group"
            data-testid="target-header-button"
          >
            <ColorfulBlockIcon
              color={getTargetColor()}
              size="xs"
              icon={getTargetIcon()}
              // For some reason this -2px adjustment is needed to align the icon with the text here for evaluators
              marginTop={target.type === "evaluator" ? "-2px" : undefined}
            />
            <Text fontSize="13px" fontWeight="medium" truncate>
              {targetName}
            </Text>
            {showVersionBadge && target.promptVersionNumber !== undefined && (
              <Box flexShrink={0}>
                <VersionBadge version={target.promptVersionNumber} />
              </Box>
            )}
            {hasMissingMappings && (
              <Tooltip
                content="Missing variable mappings - Click to configure"
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

      {/* Summary statistics (positioned on the right before play button) */}
      {hasAggregates && (
        <TargetSummary
          aggregates={aggregates}
          evaluators={evaluators}
          isRunning={isRunning}
        />
      )}

      {/* Play/Stop button on far right */}
      <Tooltip
        content={
          isRunning
            ? "Stop evaluation"
            : hasMissingMappings
              ? "Configure missing mappings first"
              : "Run evaluation"
        }
        positioning={{ placement: "top" }}
        openDelay={200}
      >
        <IconButton
          aria-label={
            isRunning ? "Stop evaluation" : "Run evaluation for this target"
          }
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
        >
          {isRunning ? <LuSquare size={14} /> : <LuPlay size={14} />}
        </IconButton>
      </Tooltip>
    </HStack>
  );
});
