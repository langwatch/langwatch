import {
  Box,
  Button,
  Circle,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import {
  LuChevronDown,
  LuCircleAlert,
  LuPencil,
  LuTrash2,
} from "react-icons/lu";

import { Menu } from "~/components/ui/menu";
import {
  EVALUATION_STATUS_COLORS,
  getStatusLabel,
  parseEvaluationResult,
} from "~/utils/evaluationResults";
import type { EvaluatorConfig } from "../../types";

// Pulsing animation for alert icon
const pulseAnimation = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
`;

type EvaluatorChipProps = {
  evaluator: EvaluatorConfig;
  result: unknown;
  /** Whether this evaluator has missing required mappings */
  hasMissingMappings?: boolean;
  onEdit: () => void;
  onRemove: () => void;
};

export function EvaluatorChip({
  evaluator,
  result,
  hasMissingMappings = false,
  onEdit,
  onRemove,
}: EvaluatorChipProps) {
  const { status, score, label, details } = parseEvaluationResult(result);

  const statusColor = EVALUATION_STATUS_COLORS[status];

  // Format inline result display
  const getInlineResult = () => {
    if (status === "pending") return null;
    if (score !== undefined) {
      return (
        <Text fontSize="10px" fontWeight="semibold" color={statusColor}>
          {score.toFixed(2)}
        </Text>
      );
    }
    if (label) {
      return (
        <Text
          fontSize="10px"
          fontWeight="medium"
          color={statusColor}
          maxWidth="60px"
          truncate
        >
          {label}
        </Text>
      );
    }
    return null;
  };

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="outline"
          size="xs"
          fontSize="11px"
          fontWeight="medium"
          borderColor={hasMissingMappings ? "orange.400" : undefined}
          css={{
            "& .chevron-icon": {
              display: "none",
            },
            "&:hover .chevron-icon": {
              display: "block",
            },
          }}
        >
          <HStack gap={1.5}>
            {/* Status indicator dot */}
            <Circle size="6px" bg={statusColor} flexShrink={0} />
            <Text>{evaluator.name}</Text>
            {/* Inline result (score or label) */}
            {getInlineResult()}
            {/* Missing mapping alert icon - on the right side like prompts */}
            {hasMissingMappings && (
              <Icon
                as={LuCircleAlert}
                color="yellow.500"
                boxSize="14px"
                css={{ animation: `${pulseAnimation} 2s ease-in-out infinite` }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                data-testid={`evaluator-missing-mapping-alert-${evaluator.id}`}
              />
            )}
            <Box className="chevron-icon" marginLeft={-0.5}>
              <LuChevronDown size={12} />
            </Box>
          </HStack>
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="220px">
        {/* Result section (if there's a result) */}
        {status !== "pending" && (
          <>
            <Box paddingX={3} paddingY={2}>
              <Text
                fontSize="11px"
                fontWeight="semibold"
                color="gray.500"
                marginBottom={1}
              >
                Result
              </Text>
              <VStack align="stretch" gap={1}>
                {score !== undefined && (
                  <HStack justify="space-between">
                    <Text fontSize="12px" color="gray.600">
                      Score:
                    </Text>
                    <Text
                      fontSize="12px"
                      fontWeight="semibold"
                      color={statusColor}
                    >
                      {score.toFixed(2)}
                    </Text>
                  </HStack>
                )}
                {label && (
                  <HStack justify="space-between">
                    <Text fontSize="12px" color="gray.600">
                      Label:
                    </Text>
                    <Text
                      fontSize="12px"
                      fontWeight="semibold"
                      color={statusColor}
                    >
                      {label}
                    </Text>
                  </HStack>
                )}
                <HStack justify="space-between">
                  <Text fontSize="12px" color="gray.600">
                    Status:
                  </Text>
                  <Text
                    fontSize="12px"
                    fontWeight="semibold"
                    color={statusColor}
                  >
                    {getStatusLabel(status)}
                  </Text>
                </HStack>
                {details && (
                  <Box marginTop={1}>
                    <Text fontSize="11px" color="gray.500" marginBottom={0.5}>
                      Details:
                    </Text>
                    <Text
                      fontSize="11px"
                      color="gray.600"
                      whiteSpace="pre-wrap"
                      maxHeight="100px"
                      overflow="auto"
                    >
                      {details}
                    </Text>
                  </Box>
                )}
              </VStack>
            </Box>
            <Box borderTopWidth="1px" borderColor="gray.200" />
          </>
        )}
        <Menu.Item value="edit" onClick={onEdit}>
          <HStack gap={2}>
            <LuPencil size={14} />
            <Text>Edit Configuration</Text>
          </HStack>
        </Menu.Item>
        <Box borderTopWidth="1px" borderColor="gray.200" my={1} />
        <Menu.Item value="remove" onClick={onRemove}>
          <HStack gap={2} color="red.600">
            <LuTrash2 size={14} />
            <Text>Remove from Workbench</Text>
          </HStack>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
