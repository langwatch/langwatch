/**
 * Evaluation Spreadsheet
 *
 * Main spreadsheet component with three sections: Dataset, Agents, Evaluators
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useShallow } from "zustand/react/shallow";
import { useEvaluationV3Store } from "../../store/useEvaluationV3Store";
import { DatasetSection } from "./DatasetSection";
import { AgentsSection } from "./AgentsSection";
import { EvaluatorsSection } from "./EvaluatorsSection";
import { useCallback, useRef, useEffect, useState } from "react";

export function EvaluationSpreadsheet() {
  const { dataset, agents, evaluators } = useEvaluationV3Store(
    useShallow((s) => ({
      dataset: s.dataset,
      agents: s.agents,
      evaluators: s.evaluators,
    }))
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [rowCount, setRowCount] = useState(0);

  // Calculate the number of rows to display
  useEffect(() => {
    if (dataset.type === "inline") {
      // Always show at least 5 empty rows, or the actual count + 3
      setRowCount(Math.max(dataset.rows.length + 3, 5));
    } else {
      // For saved datasets, we'll need to fetch the count
      setRowCount(10);
    }
  }, [dataset]);

  // Scroll sync between sections
  const handleScroll = useCallback((scrollTop: number) => {
    const container = containerRef.current;
    if (container) {
      const sections = container.querySelectorAll('[data-sync-scroll]');
      sections.forEach((section) => {
        (section as HTMLElement).scrollTop = scrollTop;
      });
    }
  }, []);

  return (
    <Box
      ref={containerRef}
      width="full"
      height="full"
      overflow="auto"
      background="gray.50"
      padding={4}
    >
      <HStack
        align="stretch"
        gap={0}
        minWidth="fit-content"
        background="white"
        borderRadius="lg"
        border="1px solid"
        borderColor="gray.200"
        overflow="hidden"
        boxShadow="sm"
      >
        {/* Row Index Column */}
        <VStack
          gap={0}
          minWidth="50px"
          borderRight="1px solid"
          borderColor="gray.200"
          flexShrink={0}
        >
          {/* Super Header placeholder */}
          <Box
            height="40px"
            width="full"
            background="gray.100"
            borderBottom="1px solid"
            borderColor="gray.200"
          />
          {/* Column Header placeholder */}
          <Box
            height="36px"
            width="full"
            background="gray.50"
            borderBottom="2px solid"
            borderColor="gray.300"
          />
          {/* Row indices */}
          {Array.from({ length: rowCount }).map((_, i) => (
            <Box
              key={i}
              height="40px"
              width="full"
              display="flex"
              alignItems="center"
              justifyContent="center"
              borderBottom="1px solid"
              borderColor="gray.100"
              background="gray.50"
              color="gray.500"
              fontSize="xs"
            >
              {i + 1}
            </Box>
          ))}
        </VStack>

        {/* Dataset Section */}
        <DatasetSection rowCount={rowCount} onScroll={handleScroll} />

        {/* Agents Section */}
        <AgentsSection rowCount={rowCount} onScroll={handleScroll} />

        {/* Evaluators Section */}
        <EvaluatorsSection rowCount={rowCount} onScroll={handleScroll} />
      </HStack>
    </Box>
  );
}

// Super Header Component
export function SuperHeader({
  title,
  colorScheme,
  children,
  minWidth = "200px",
}: {
  title: string;
  colorScheme: "blue" | "purple" | "green";
  children?: React.ReactNode;
  minWidth?: string;
}) {
  const bgColors = {
    blue: "blue.50",
    purple: "purple.50",
    green: "green.50",
  };

  const borderColors = {
    blue: "blue.200",
    purple: "purple.200",
    green: "green.200",
  };

  const textColors = {
    blue: "blue.700",
    purple: "purple.700",
    green: "green.700",
  };

  return (
    <Box
      height="40px"
      minWidth={minWidth}
      background={bgColors[colorScheme]}
      borderBottom="1px solid"
      borderColor={borderColors[colorScheme]}
      display="flex"
      alignItems="center"
      justifyContent="space-between"
      paddingX={3}
    >
      <Text
        fontSize="sm"
        fontWeight="semibold"
        color={textColors[colorScheme]}
        textTransform="uppercase"
        letterSpacing="wide"
      >
        {title}
      </Text>
      {children}
    </Box>
  );
}

// Column Header Component
export function ColumnHeader({
  title,
  icon,
  hasWarning,
  onClick,
  onSettingsClick,
  width = "180px",
}: {
  title: string;
  icon?: React.ReactNode;
  hasWarning?: boolean;
  onClick?: () => void;
  onSettingsClick?: () => void;
  width?: string;
}) {
  return (
    <Box
      height="36px"
      width={width}
      minWidth={width}
      background="gray.50"
      borderBottom="2px solid"
      borderColor="gray.300"
      borderRight="1px solid"
      borderRightColor="gray.200"
      display="flex"
      alignItems="center"
      paddingX={2}
      gap={2}
      cursor={onClick ? "pointer" : "default"}
      _hover={onClick ? { background: "gray.100" } : undefined}
      onClick={onClick}
      position="relative"
    >
      {icon}
      <Text
        fontSize="xs"
        fontWeight="medium"
        color="gray.700"
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        flex={1}
      >
        {title}
      </Text>
      {hasWarning && (
        <Box
          position="absolute"
          right={2}
          top="50%"
          transform="translateY(-50%)"
          width="16px"
          height="16px"
          borderRadius="full"
          background="orange.100"
          color="orange.600"
          display="flex"
          alignItems="center"
          justifyContent="center"
          fontSize="xs"
          fontWeight="bold"
        >
          !
        </Box>
      )}
    </Box>
  );
}

// Cell Component
export function SpreadsheetCell({
  value,
  rowIndex,
  columnId,
  section,
  isEditable = true,
  isResult = false,
  resultStatus,
  width = "180px",
  onClick,
  onDoubleClick,
}: {
  value: string | number | boolean | null | undefined;
  rowIndex: number;
  columnId: string;
  section: "dataset" | "agent" | "evaluator";
  isEditable?: boolean;
  isResult?: boolean;
  resultStatus?: "success" | "error" | "running" | "pending";
  width?: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
}) {
  const { expandedCell, setExpandedCell, setCellValue } = useEvaluationV3Store(
    useShallow((s) => ({
      expandedCell: s.expandedCell,
      setExpandedCell: s.setExpandedCell,
      setCellValue: s.setCellValue,
    }))
  );

  const isExpanded =
    expandedCell?.section === section &&
    expandedCell?.columnId === columnId &&
    expandedCell?.rowIndex === rowIndex;

  const displayValue =
    value === null || value === undefined
      ? ""
      : typeof value === "boolean"
        ? value
          ? "✓"
          : "✗"
        : String(value);

  const getBgColor = () => {
    if (isResult) {
      switch (resultStatus) {
        case "success":
          return "green.50";
        case "error":
          return "red.50";
        case "running":
          return "blue.50";
        default:
          return "white";
      }
    }
    return rowIndex % 2 === 0 ? "white" : "gray.50";
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && isEditable) {
      setExpandedCell({ section, columnId, rowIndex });
    }
  };

  return (
    <Box
      height="40px"
      width={width}
      minWidth={width}
      background={getBgColor()}
      borderBottom="1px solid"
      borderColor="gray.100"
      borderRight="1px solid"
      borderRightColor="gray.200"
      display="flex"
      alignItems="center"
      paddingX={2}
      cursor={isEditable ? "text" : "default"}
      onClick={onClick}
      onDoubleClick={() => {
        if (isEditable) {
          setExpandedCell({ section, columnId, rowIndex });
        }
        onDoubleClick?.();
      }}
      onKeyDown={handleKeyDown}
      tabIndex={isEditable ? 0 : -1}
      position="relative"
      _hover={isEditable ? { background: "blue.50" } : undefined}
      _focus={isEditable ? {
        outline: "2px solid",
        outlineColor: "blue.400",
        outlineOffset: "-2px",
      } : undefined}
      transition="all 0.15s ease-in-out"
      css={{
        "@keyframes fadeIn": {
          from: { opacity: 0, transform: "scale(0.98)" },
          to: { opacity: 1, transform: "scale(1)" },
        },
        animation: isResult && resultStatus ? "fadeIn 0.2s ease-out" : undefined,
      }}
    >
      <Text
        fontSize="sm"
        color={displayValue ? "gray.800" : "gray.400"}
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        width="full"
      >
        {displayValue || (isEditable ? "Click to edit..." : "")}
      </Text>
    </Box>
  );
}

