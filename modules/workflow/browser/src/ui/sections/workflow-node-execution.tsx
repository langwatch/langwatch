import { Box, Button, type ButtonProps, Center, Spinner } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { Component } from "@langwatch/workflow-contract";
import { checkIsEvaluator } from "@langwatch/workflow-contract";
import type { Node } from "@xyflow/react";
import type { ReactNode } from "react";
import { Check, MinusCircle, Play, Square, X } from "react-feather";
import { PulseLoader } from "react-spinners";
import { useDebounceValue } from "usehooks-ts";

import { useRunUntilHereDialogStore } from "../../behavior/use-run-until-here-dialog-store.ts";
import { useWorkflowStore } from "../../behavior/use-workflow-store.ts";
import { useWorkflowNodeHost } from "../elements/workflow-node.host.tsx";

function hasEvaluatorError(node: Node<Component>): boolean {
  if (!checkIsEvaluator(node)) return false;
  if (node.data.execution_state?.status !== "success") return false;

  const outputs = node.data.execution_state.outputs;
  if (outputs?.status === "error") return true;
  return outputs?.passed === false;
}

function executionStatusIcon({
  node,
  iconSize,
}: {
  node: Node<Component>;
  iconSize: number;
}): ReactNode {
  const status = node.data.execution_state?.status;

  if (status === "error" || hasEvaluatorError(node)) {
    return (
      <Box color="red.500">
        <X size={iconSize} />
      </Box>
    );
  }

  if (status === "success") {
    let color = "green.500";
    if (checkIsEvaluator(node)) {
      const outputStatus = node.data.execution_state?.outputs?.status;
      if (outputStatus === "skipped") {
        color = "yellow.500";
      }
    }

    return (
      <Box color={color}>
        <Check size={iconSize} />
      </Box>
    );
  }

  if (status === "skipped") {
    return (
      <Box color="gray.400" data-testid="node-status-skipped">
        <MinusCircle size={iconSize} />
      </Box>
    );
  }

  return null;
}

export function ComponentExecutionButton({
  node,
  iconSize = 14,
  componentOnly = false,
  ...props
}: {
  node: Node<Component>;
  iconSize?: number;
  componentOnly?: boolean;
} & ButtonProps) {
  const { useComponentExecution } = useWorkflowNodeHost();
  const { startComponentExecution, stopComponentExecution } = useComponentExecution();

  const openRunUntilHereDialog = useRunUntilHereDialogStore((state) => state.open);

  const [isWaitingLong] = useDebounceValue(node?.data.execution_state?.status === "waiting", 600);

  const { propertiesExpanded, setPropertiesExpanded, setSelectedNode } = useWorkflowStore(
    ({ propertiesExpanded, setPropertiesExpanded, setSelectedNode }) => ({
      propertiesExpanded,
      setPropertiesExpanded,
      setSelectedNode,
    }),
  );

  const executionStatus = node.data.execution_state?.status;
  const shouldOpenExecutionResults = node.data.execution_state && !propertiesExpanded;
  const isExecuting = executionStatus === "running" || executionStatus === "waiting";
  const showRunButton = !isExecuting && componentOnly;
  const showRunMenu = !isExecuting && !componentOnly;

  return (
    <>
      <Tooltip
        content={shouldOpenExecutionResults ? "Execution results" : ""}
        positioning={{ placement: "top" }}
        showArrow
      >
        <Center
          minWidth="24px"
          minHeight="24px"
          maxWidth="24px"
          maxHeight="24px"
          marginRight="-4px"
          marginLeft="-4px"
          role={shouldOpenExecutionResults ? "button" : void 0}
          cursor={node.data.execution_state ? "pointer" : void 0}
          onClick={() => {
            if (shouldOpenExecutionResults) {
              setSelectedNode(node.id);
              setPropertiesExpanded(true);
            } else {
              setPropertiesExpanded(false);
            }
          }}
        >
          {isWaitingLong && executionStatus === "waiting" && (
            <Box marginLeft="-4px" marginRight="-4px">
              <PulseLoader size={2} speedMultiplier={0.5} />
            </Box>
          )}
          {!isWaitingLong && executionStatus === "waiting" && <Spinner size="xs" />}
          {executionStatus === "running" && <Spinner size="xs" />}
          {executionStatusIcon({ node, iconSize })}
        </Center>
      </Tooltip>
      {isExecuting && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            if (node) {
              stopComponentExecution({
                node_id: node.id,
                trace_id: node.data.execution_state?.trace_id ?? "",
                current_state: node.data.execution_state,
              });
            }
          }}
          {...props}
        >
          <Square size={iconSize} />
        </Button>
      )}
      {showRunButton && (
        <Button
          variant="ghost"
          size="xs"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (node) startComponentExecution({ node });
          }}
        >
          <Play size={iconSize} />
        </Button>
      )}
      {showRunMenu && (
        <Menu.Root positioning={{ placement: "top-start" }}>
          <Menu.Trigger asChild>
            <Button
              variant="ghost"
              size="xs"
              paddingX={2}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              {...props}
            >
              <Play size={iconSize} />
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item value="run-manual" onClick={() => node && startComponentExecution({ node })}>
              <Play size={14} />
              Run with manual input
            </Menu.Item>
            <Menu.Item value="run-workflow" onClick={() => node && openRunUntilHereDialog(node.id)}>
              <Play size={14} />
              Run workflow until here
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      )}
    </>
  );
}
