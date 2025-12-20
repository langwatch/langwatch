import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Database, Hash, List, MessageSquare, Plus, Type } from "lucide-react";

import { ColorfulBlockIcon } from "~/optimization_studio/components/ColorfulBlockIcons";
import { LLMIcon } from "~/components/icons/LLMIcon";
import type { DatasetReference } from "../types";
import { DatasetTabs } from "./DatasetSection/DatasetTabs";

// ============================================================================
// Types
// ============================================================================

export type SuperHeaderType = "dataset" | "agents";

export type DatasetHandlers = {
  onSelectExisting: () => void;
  onUploadCSV: () => void;
  onEditDataset: () => void;
  onSaveAsDataset: (dataset: DatasetReference) => void;
};

// ============================================================================
// Pulsing Dot Indicator (radar-style)
// ============================================================================

export function PulsingDot() {
  return (
    <>
      <style>
        {`
          @keyframes evalRadar {
            0% { transform: scale(1); opacity: 0.6; }
            100% { transform: scale(2.5); opacity: 0; }
          }
        `}
      </style>
      <Box
        as="span"
        position="relative"
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        marginLeft={2}
      >
        {/* Expanding ring */}
        <Box
          as="span"
          position="absolute"
          width="8px"
          height="8px"
          borderRadius="full"
          bg="blue.300"
          style={{ animation: "evalRadar 1.5s ease-out infinite" }}
        />
        {/* Fixed center dot */}
        <Box
          as="span"
          position="relative"
          width="6px"
          height="6px"
          borderRadius="full"
          bg="blue.500"
        />
      </Box>
    </>
  );
}

// ============================================================================
// Column Type Icons
// ============================================================================

export const ColumnTypeIcon = ({ type }: { type: string }) => {
  const iconProps = { size: 12, strokeWidth: 2.5 };

  switch (type) {
    case "string":
      return <Type {...iconProps} color="var(--chakra-colors-blue-500)" />;
    case "number":
      return <Hash {...iconProps} color="var(--chakra-colors-green-500)" />;
    case "json":
      return <List {...iconProps} color="var(--chakra-colors-purple-500)" />;
    case "chat_messages":
      return (
        <MessageSquare {...iconProps} color="var(--chakra-colors-orange-500)" />
      );
    default:
      return <Type {...iconProps} color="var(--chakra-colors-gray-400)" />;
  }
};

// ============================================================================
// Super Header Component
// ============================================================================

type SuperHeaderProps = {
  type: SuperHeaderType;
  colSpan: number;
  onAddClick?: () => void;
  showWarning?: boolean;
  activeDataset?: DatasetReference;
  datasetHandlers?: DatasetHandlers;
};

const superHeaderConfig: Record<
  SuperHeaderType,
  { title: string; color: string; icon: React.ReactNode }
> = {
  dataset: {
    title: "Dataset",
    color: "blue.400",
    icon: <Database size={14} />,
  },
  agents: {
    title: "Agents",
    color: "green.400",
    icon: <LLMIcon />,
  },
};

export function SuperHeader({
  type,
  colSpan,
  onAddClick,
  showWarning,
  activeDataset,
  datasetHandlers,
}: SuperHeaderProps) {
  const config = superHeaderConfig[type];

  return (
    <th
      colSpan={colSpan}
      style={{
        padding: "12px 12px",
        paddingLeft: type === "dataset" ? "52px" : "12px",
        textAlign: "left",
        borderBottom: "1px solid var(--chakra-colors-gray-200)",
        backgroundColor: "white",
        height: "48px",
      }}
    >
      <HStack gap={2}>
        <ColorfulBlockIcon color={config.color} size="sm" icon={config.icon} />
        {type === "dataset" && activeDataset && datasetHandlers ? (
          <DatasetTabs
            onSelectExisting={datasetHandlers.onSelectExisting}
            onUploadCSV={datasetHandlers.onUploadCSV}
            onEditDataset={datasetHandlers.onEditDataset}
            onSaveAsDataset={datasetHandlers.onSaveAsDataset}
          />
        ) : (
          <Text fontWeight="semibold" fontSize="sm" color="gray.700">
            {config.title}
          </Text>
        )}
        {onAddClick && (
          <Button
            size="xs"
            variant="ghost"
            onClick={onAddClick}
            color="gray.500"
            _hover={{ color: "gray.700" }}
          >
            <Plus size={12} />
            Add Agent
            {showWarning && <PulsingDot />}
          </Button>
        )}
      </HStack>
    </th>
  );
}

