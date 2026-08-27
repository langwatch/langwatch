import {
  Alert,
  Box,
  Button,
  Center,
  EmptyState,
  HStack,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState, type ReactNode } from "react";
import { X } from "react-feather";
import { LuSquareCheckBig } from "react-icons/lu";

export function WorkflowResultsPanel({
  isCollapsed,
  onCollapse,
  children,
}: {
  isCollapsed: boolean;
  onCollapse: () => void;
  children: ReactNode;
}) {
  return (
    <HStack
      display={isCollapsed ? "none" : undefined}
      background="bg"
      borderTop="2px solid"
      borderColor="border"
      width="full"
      fontSize="14px"
      height="full"
      align="start"
      position="relative"
    >
      <Button
        variant="ghost"
        onClick={onCollapse}
        position="absolute"
        top={1}
        right={1}
        size="xs"
        zIndex={1}
      >
        <X size={16} />
      </Button>
      <Tabs.Root
        value="evaluations"
        width="full"
        height="full"
        display="flex"
        flexDirection="column"
        size="sm"
        colorPalette="blue"
      >
        <Tabs.List borderBottomWidth="2px">
          <Tabs.Trigger value="evaluations">Evaluations</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="evaluations" padding={0} height="calc(100% - 32px)">
          {!isCollapsed && children}
        </Tabs.Content>
      </Tabs.Root>
    </HStack>
  );
}

type WorkflowEvaluationResultsLayoutProps =
  | { status: "loading" }
  | { status: "waiting" }
  | { status: "error" }
  | {
      status: "ready";
      sidebar: ReactNode;
      table: ReactNode;
      footer?: ReactNode;
    };

export function WorkflowEvaluationResultsLayout(props: WorkflowEvaluationResultsLayoutProps) {
  if (props.status === "loading") {
    return <Text padding={4}>Loading...</Text>;
  }

  if (props.status === "waiting") {
    return (
      <Center width="full" height="full">
        <EmptyState.Root marginTop="-60px">
          <EmptyState.Content>
            <EmptyState.Indicator>
              <LuSquareCheckBig />
            </EmptyState.Indicator>
            <EmptyState.Title>Waiting for evaluation results</EmptyState.Title>
            <EmptyState.Description>
              Run your first evaluation to see the results here
            </EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      </Center>
    );
  }

  if (props.status === "error") {
    return (
      <Alert.Root status="error">
        <Alert.Indicator />
        Error loading evaluation results
      </Alert.Root>
    );
  }

  return (
    <HStack align="stretch" width="full" height="full" gap={0}>
      {props.sidebar}
      <VStack gap={0} width="full" height="full" minWidth="0" minHeight="0">
        <Box flex={1} width="full" minHeight="0" overflow="hidden">
          {props.table}
        </Box>
        {props.footer}
      </VStack>
    </HStack>
  );
}

export function useWorkflowSelectedEvaluationRun(evaluationRunId: string | undefined) {
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(evaluationRunId);

  useEffect(() => {
    setSelectedRunId(evaluationRunId);
  }, [evaluationRunId]);

  return { selectedRunId, setSelectedRunId };
}
