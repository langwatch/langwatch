import { Box, Card, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { SimulationStatusOverlay } from "./SimulationStatusOverlay";
import {
  SCENARIO_RUN_STATUS_CONFIG,
  SCENARIO_RUN_STATUS_ICONS,
} from "./scenario-run-status-config";

export interface SimulationCardMessage {
  role: "agent" | "user";
  content: string;
}

export interface SimulationCardProps {
  title: string;
  description?: string;
  status?: ScenarioRunStatus;
  isActive?: boolean;
  isLoading?: boolean;
  /** Data loaded but no messages yet (PENDING/QUEUED) */
  isAwaitingMessages?: boolean;
  children: React.ReactNode;
}


function SimulationCardHeader({
  title,
  status,
}: {
  title: string;
  status?: ScenarioRunStatus;
}) {
  const isComplete = status
    ? SCENARIO_RUN_STATUS_CONFIG[status].isComplete
    : false;

  return (
    <Box py={2} px={3} w="100%" position="relative" zIndex={2}>
      <Text
        fontSize="xs"
        fontWeight="semibold"
        color={isComplete ? "white" : "fg"}
        lineClamp={2}
      >
        {title}
      </Text>
    </Box>
  );
}

function SimulationCardSkeleton() {
  return (
    <VStack
      p={4}
      gap={4}
      align="stretch"
      height="100%"
      css={{
        "@keyframes shimmer": {
          "0%": { opacity: 0.4 },
          "50%": { opacity: 0.7 },
          "100%": { opacity: 0.4 },
        },
      }}
    >
      {/* User message skeleton */}
      <HStack justify="flex-end">
        <Box
          bg="bg.muted"
          borderRadius="lg"
          h="32px"
          w="65%"
          css={{ animation: "shimmer 1.5s ease-in-out infinite" }}
        />
      </HStack>
      {/* Assistant message skeleton */}
      <VStack align="flex-start" gap={2}>
        <Box
          bg="bg.muted"
          borderRadius="lg"
          h="14px"
          w="90%"
          css={{ animation: "shimmer 1.5s ease-in-out 0.15s infinite" }}
        />
        <Box
          bg="bg.muted"
          borderRadius="lg"
          h="14px"
          w="75%"
          css={{ animation: "shimmer 1.5s ease-in-out 0.3s infinite" }}
        />
        <Box
          bg="bg.muted"
          borderRadius="lg"
          h="14px"
          w="60%"
          css={{ animation: "shimmer 1.5s ease-in-out 0.45s infinite" }}
        />
      </VStack>
      {/* Second user message skeleton */}
      <HStack justify="flex-end">
        <Box
          bg="bg.muted"
          borderRadius="lg"
          h="28px"
          w="50%"
          css={{ animation: "shimmer 1.5s ease-in-out 0.6s infinite" }}
        />
      </HStack>
      {/* Second assistant message skeleton */}
      <VStack align="flex-start" gap={2}>
        <Box
          bg="bg.muted"
          borderRadius="lg"
          h="14px"
          w="85%"
          css={{ animation: "shimmer 1.5s ease-in-out 0.75s infinite" }}
        />
        <Box
          bg="bg.muted"
          borderRadius="lg"
          h="14px"
          w="70%"
          css={{ animation: "shimmer 1.5s ease-in-out 0.9s infinite" }}
        />
      </VStack>
    </VStack>
  );
}

function SimulationCardAwaitingState({ description }: { description?: string }) {
  return (
    <VStack
      height="100%"
      justify="center"
      align="center"
      gap={4}
      p={4}
      css={{
        "@keyframes ripple": {
          "0%": { transform: "scale(0.8)", opacity: 0.4 },
          "50%": { transform: "scale(1)", opacity: 0.15 },
          "100%": { transform: "scale(0.8)", opacity: 0.4 },
        },
      }}
    >
      {/* Concentric pulsing rings */}
      <Box position="relative" w="64px" h="64px">
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            position="absolute"
            inset={`${i * 8}px`}
            borderRadius="full"
            border="1px solid"
            borderColor="fg.muted"
            css={{
              animation: `ripple 2.4s ease-in-out ${i * 0.4}s infinite`,
            }}
          />
        ))}
      </Box>
      {description && (
        <Text
          fontSize="xs"
          color="fg.muted"
          textAlign="center"
          lineClamp={2}
          maxW="90%"
        >
          {description}
        </Text>
      )}
    </VStack>
  );
}

function SimulationCardContent({ children }: { children: React.ReactNode }) {
  return (
    <Card.Body
      p={0}
      height="100%"
      overflow="hidden"
      position="relative"
      w="100%"
    >
      <Box height="100%" width="100%" position="relative">
        {children}
      </Box>
    </Card.Body>
  );
}

function SimulationStatusBadge({ status }: { status: ScenarioRunStatus }) {
  const config = SCENARIO_RUN_STATUS_CONFIG[status];
  const Icon = SCENARIO_RUN_STATUS_ICONS[status];
  const isRunning =
    status === ScenarioRunStatus.RUNNING ||
    status === ScenarioRunStatus.IN_PROGRESS;
  const isPending =
    status === ScenarioRunStatus.PENDING || status === ScenarioRunStatus.QUEUED;

  return (
    <Box
      position="absolute"
      bottom={3}
      left="50%"
      transform="translateX(-50%)"
      zIndex={10}
      pointerEvents="none"
    >
      <HStack
        gap={1.5}
        px={3}
        py={1}
        borderRadius="full"
        bg={`color-mix(in srgb, var(--chakra-colors-${config.colorPalette}-subtle) 80%, transparent)`}
        boxShadow="0 2px 8px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)"
        border="1px solid"
        borderColor={`color-mix(in srgb, var(--chakra-colors-${config.colorPalette}-muted) 50%, transparent)`}
        color={config.fgColor}
      >
        {isRunning || isPending ? (
          <Spinner size="xs" color={config.fgColor} />
        ) : (
          <Icon size={12} color="currentColor" />
        )}
        <Text
          fontSize="xs"
          fontWeight="semibold"
          textTransform="capitalize"
          lineHeight="1"
        >
          {config.label}
        </Text>
      </HStack>
    </Box>
  );
}

/**
 * SimulationCard renders each scenario run as a visual card.
 */
export function SimulationCard({
  title,
  description,
  status,
  isActive,
  isLoading,
  isAwaitingMessages,
  children,
}: SimulationCardProps) {
  const isComplete = status
    ? SCENARIO_RUN_STATUS_CONFIG[status].isComplete
    : false;

  const shouldDim = isComplete && !isActive;

  return (
    <Card.Root
      height="100%"
      border="1px solid rgba(255,255,255,0.12)"
      borderRadius="xl"
      position="relative"
      bg="bg.panel"
      css={{
        overflow: "hidden !important",
        contain: "content",
        boxShadow: "sm",
        "&:hover .simulation-card-content": {
          opacity: 1,
        },
        /* Hide scrollbar by default, show on card hover */
        "& .simulation-chat-scroll": {
          scrollbarWidth: "none",
        },
        "&:hover .simulation-chat-scroll": {
          scrollbarWidth: "thin",
        },
        "& .simulation-chat-scroll::-webkit-scrollbar": {
          display: "none",
        },
        "&:hover .simulation-chat-scroll::-webkit-scrollbar": {
          display: "block",
          width: "6px",
        },
      }}
    >
      <VStack height="100%" gap={0}>
        {!isLoading && <SimulationCardHeader title={title} status={status} />}
        <Box
          className="simulation-card-content"
          opacity={shouldDim ? 0.45 : 1}
          transition="opacity 0.3s ease"
          height="100%"
          width="100%"
          overflow="hidden"
        >
          {isLoading ? (
            <SimulationCardSkeleton />
          ) : isAwaitingMessages ? (
            <SimulationCardAwaitingState description={description} />
          ) : (
            <SimulationCardContent>{children}</SimulationCardContent>
          )}
        </Box>
      </VStack>
      {isComplete && status && <SimulationStatusOverlay status={status} />}
      {status && <SimulationStatusBadge status={status} />}
    </Card.Root>
  );
}
