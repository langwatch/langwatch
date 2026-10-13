import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Alert,
  Box,
  Center,
  Heading,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { SquareCheckBig, X } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

export function WorkflowResultsPanel({
  isCollapsed,
  onCollapse,
  children,
}: {
  isCollapsed: boolean;
  onCollapse: () => void;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <HStack
      display={isCollapsed ? "none" : undefined}
      background="bg"
      borderTop="2px solid"
      borderColor="border"
      width="full"
      textStyle="sm"
      height="full"
      align="start"
      position="relative"
    >
      <IconButton
        aria-label="Collapse results"
        variant="ghost"
        onClick={onCollapse}
        position="absolute"
        top={1}
        right={1}
        size="xs"
        zIndex={1}
      >
        <X size={16} />
      </IconButton>
      <VStack align="stretch" gap={0} width="full" height="full">
        <Box
          flexShrink={0}
          height="32px"
          display="flex"
          alignItems="stretch"
          borderBottomWidth="2px"
          borderColor="border"
        >
          <Box
            position="relative"
            display="flex"
            alignItems="center"
            paddingX={3}
            paddingY={1}
            _after={{
              content: '""',
              position: "absolute",
              left: 0,
              right: 0,
              bottom: "-1px",
              height: "2px",
              bg: "blue.indicator",
              pointerEvents: "none",
            }}
          >
            <Heading as="h2" id={headingId} textStyle="bodySm" fontWeight="600" color="fg">
              Evaluations
            </Heading>
          </Box>
        </Box>
        <Box as="section" aria-labelledby={headingId} flex={1} minHeight={0}>
          {!isCollapsed && children}
        </Box>
      </VStack>
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
        <NoDataInfoBlock
          title="Waiting for evaluation results"
          description="Run your first evaluation to see the results here"
          icon={<SquareCheckBig />}
          next={[
            {
              kind: "docs",
              label: "How workflows work",
              href: "https://docs.langwatch.ai/workflows/building-a-workflow",
            },
          ]}
        />
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

  const [runIdFrom, setRunIdFrom] = useState(evaluationRunId);
  if (runIdFrom !== evaluationRunId) {
    setRunIdFrom(evaluationRunId);
    setSelectedRunId(evaluationRunId);
  }

  return { selectedRunId, setSelectedRunId };
}
