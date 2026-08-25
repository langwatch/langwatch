/**
 * TableSettingsMenu - "Run Options" popover menu for the workbench toolbar.
 *
 * Contains:
 * - Row height toggle (compact/fit)
 * - Concurrency control
 * - Automation: opens the "Run via API" dialog to run this evaluation from a
 *   pipeline
 */
import {
  Box,
  Button,
  HStack,
  Input,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import {
  ListChevronsDownUp,
  ListChevronsUpDown,
  SlidersHorizontal,
  Terminal,
} from "lucide-react";
import React, { useState } from "react";
import { LuGauge } from "react-icons/lu";
import type { RowHeightMode } from "~/components/datasets/editor/DatasetTableContext";
import { Popover } from "~/components/ui/popover";
import { SimpleSlider } from "~/components/ui/slider";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { DEFAULT_CONCURRENCY } from "../types";
import { RunViaApiDialogContainer } from "./RunViaApiButton";

type ToggleOption = {
  value: RowHeightMode;
  label: string;
  icon: React.ReactNode;
};

const rowHeightOptions: ToggleOption[] = [
  {
    value: "compact",
    label: "Compact",
    icon: <ListChevronsDownUp size={18} />,
  },
  {
    value: "fit",
    label: "Fit",
    icon: <ListChevronsUpDown size={18} />,
  },
];

// Max rows for expanded mode
const MAX_ROWS_FOR_FIT_MODE = 100;

// =============================================================================
// Concurrency Popover Component
// =============================================================================

type ConcurrencyPopoverProps = {
  value: number;
  onChange: (value: number) => void;
};

const ConcurrencyPopover = React.memo(function ConcurrencyPopover({
  value,
  onChange,
}: ConcurrencyPopoverProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value.toString());

  // Sync input when value changes externally
  React.useEffect(() => {
    setInputValue(value.toString());
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputBlur = () => {
    const parsed = parseInt(inputValue, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 24) {
      onChange(parsed);
    } else {
      setInputValue(value.toString());
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleInputBlur();
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      positioning={{ placement: "bottom-end" }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          size="xs"
          justifyContent="space-between"
          paddingX={3}
          paddingY={2}
          height="auto"
          fontSize="13px"
          fontWeight="normal"
          width="100%"
          _hover={{ bg: "bg.subtle" }}
        >
          <HStack gap={2} color="fg.muted" fontWeight="600">
            <LuGauge />
            <Text>Concurrency</Text>
          </HStack>
          <Text>{value}</Text>
        </Button>
      </Popover.Trigger>
      <Popover.Content width="220px" padding={3}>
        <VStack align="stretch" gap={3}>
          <HStack gap={3}>
            <Input
              value={inputValue}
              onChange={handleInputChange}
              onBlur={handleInputBlur}
              onKeyDown={handleInputKeyDown}
              size="sm"
              width="50px"
              textAlign="center"
              paddingX={1}
            />
            <SimpleSlider
              value={[value]}
              onValueChange={({ value: newValue }) => {
                const v = newValue[0] ?? DEFAULT_CONCURRENCY;
                onChange(v);
                setInputValue(v.toString());
              }}
              min={1}
              max={24}
              step={1}
              size="sm"
              flex={1}
            />
          </HStack>
          <Text fontSize="11px" color="fg.muted">
            Higher values run more cells in parallel but may cause rate limiting
          </Text>
        </VStack>
      </Popover.Content>
    </Popover.Root>
  );
});

// =============================================================================
// Main Component
// =============================================================================

type TableSettingsMenuProps = {
  disabled?: boolean;
};

/**
 * Popover menu containing table settings and actions. Surfaced in the toolbar
 * as a "Run Options" button.
 */
export function TableSettingsMenu({
  disabled = false,
}: TableSettingsMenuProps) {
  const {
    rowHeightMode,
    setRowHeightMode,
    concurrency,
    setConcurrency,
    experimentSlug,
    getRowCount,
    activeDatasetId,
  } = useEvaluationsV3Store((state) => ({
    rowHeightMode: state.ui.rowHeightMode,
    setRowHeightMode: state.setRowHeightMode,
    concurrency: state.ui.concurrency,
    setConcurrency: state.setConcurrency,
    experimentSlug: state.experimentSlug,
    getRowCount: state.getRowCount,
    activeDatasetId: state.activeDatasetId,
  }));

  // Get current row count to determine if expanded mode should be disabled
  const rowCount = getRowCount(activeDatasetId);
  const isFitDisabled = rowCount > MAX_ROWS_FOR_FIT_MODE;

  const { project } = useOrganizationTeamProject();
  const runDialog = useDisclosure();
  const [popoverOpen, setPopoverOpen] = React.useState(false);

  // Show the Run via API automation entry only if we have an experiment slug
  const showRunViaApi = !!project && !!experimentSlug;

  const handleOpenRunDialog = () => {
    setPopoverOpen(false); // Close popover first
    runDialog.onOpen();
  };

  return (
    <>
      <Popover.Root
        open={popoverOpen}
        onOpenChange={(e) => setPopoverOpen(e.open)}
      >
        <Popover.Trigger asChild>
          <Button
            variant="ghost"
            size="sm"
            color="fg.muted"
            _hover={{ color: "fg", bg: "bg.subtle" }}
            disabled={disabled}
            aria-label="Run Options"
          >
            <SlidersHorizontal size={18} />
            Run Options
          </Button>
        </Popover.Trigger>
        <Popover.Content width="auto" padding={3}>
          <VStack align="stretch" gap={3}>
            {/* Row Height Section */}
            <VStack align="stretch" gap={2}>
              <Text fontSize="xs" fontWeight="medium" color="fg.muted">
                Row height
              </Text>
              <HStack gap={2}>
                {rowHeightOptions.map((option) => {
                  const isActive = rowHeightMode === option.value;
                  const isDisabled = option.value === "fit" && isFitDisabled;

                  const button = (
                    <Button
                      key={option.value}
                      variant={isActive ? "surface" : "ghost"}
                      onClick={() =>
                        !isDisabled && setRowHeightMode(option.value)
                      }
                      display="flex"
                      flexDirection="column"
                      alignItems="center"
                      gap={1.5}
                      paddingX={4}
                      paddingY={3}
                      height="auto"
                      minWidth="80px"
                      fontSize="12px"
                      disabled={isDisabled}
                      opacity={isDisabled ? 0.5 : 1}
                      cursor={isDisabled ? "not-allowed" : "pointer"}
                    >
                      {option.icon}
                      <Text>{option.label}</Text>
                    </Button>
                  );

                  if (isDisabled) {
                    return (
                      <Tooltip
                        key={option.value}
                        content={`Fit mode is disabled for datasets with more than ${MAX_ROWS_FOR_FIT_MODE} rows for performance reasons`}
                        positioning={{ placement: "top" }}
                        openDelay={100}
                      >
                        <Box>{button}</Box>
                      </Tooltip>
                    );
                  }

                  return button;
                })}
              </HStack>
            </VStack>

            {/* Concurrency Section */}
            <Box borderTopWidth="1px" borderColor="border" />
            <Text fontSize="xs" fontWeight="medium" color="fg.muted">
              Concurrency
            </Text>
            <VStack align="stretch" gap={1}>
              <ConcurrencyPopover
                value={concurrency}
                onChange={setConcurrency}
              />
            </VStack>

            {/* Automation Section */}
            {showRunViaApi && (
              <>
                <Box borderTopWidth="1px" borderColor="border" />
                <VStack align="stretch" gap={1}>
                  <Text fontSize="xs" fontWeight="medium" color="fg.muted">
                    Automation
                  </Text>
                  <Button
                    variant="outline"
                    justifyContent="flex-start"
                    paddingX={3}
                    paddingY={2}
                    height="auto"
                    fontSize="13px"
                    fontWeight="normal"
                    onClick={handleOpenRunDialog}
                    _hover={{ bg: "bg.subtle" }}
                  >
                    <HStack gap={2}>
                      <Terminal size={16} />
                      <VStack align="flex-start" gap={0}>
                        <Text>Run in CI/CD</Text>
                        <Text fontSize="11px" color="fg.muted">
                          Execute from your pipeline
                        </Text>
                      </VStack>
                    </HStack>
                  </Button>
                </VStack>
              </>
            )}
          </VStack>
        </Popover.Content>
      </Popover.Root>

      {/* Run via API dialog (supersedes the old CI/CD snippet dialog) */}
      {showRunViaApi && (
        <RunViaApiDialogContainer
          open={runDialog.open}
          onOpenChange={(open) =>
            open ? runDialog.onOpen() : runDialog.onClose()
          }
        />
      )}
    </>
  );
}
