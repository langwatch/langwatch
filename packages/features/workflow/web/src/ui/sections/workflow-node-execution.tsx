import { Box, Button, type ButtonProps, Center, Spinner } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { Check, MinusCircle, Play, Square, X } from "react-feather";
import { PulseLoader } from "react-spinners";
import { useDebounceValue } from "usehooks-ts";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { Component } from "@langwatch/workflow-contract";
import { checkIsEvaluator } from "@langwatch/workflow-contract";
import { useRunUntilHereDialogStore } from "../../behavior/use-run-until-here-dialog-store";
import { useWorkflowStore } from "../../behavior/use-workflow-store";
import { useWorkflowNodeHost } from "../elements/workflow-node.host";

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

  const shouldOpenExecutionResults = node?.data.execution_state && !propertiesExpanded;

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
          cursor={node?.data.execution_state ? "pointer" : void 0}
          onClick={() => {
            if (shouldOpenExecutionResults) {
              setSelectedNode(node.id);
              setPropertiesExpanded(true);
            } else {
              setPropertiesExpanded(false);
            }
          }}
        >
          {isWaitingLong && node?.data.execution_state?.status === "waiting" && (
            <Box marginLeft="-4px" marginRight="-4px">
              <PulseLoader size={2} speedMultiplier={0.5} />
            </Box>
          )}
          {((!isWaitingLong && node?.data.execution_state?.status === "waiting") ||
            node?.data.execution_state?.status === "running") && <Spinner size="xs" />}
          {node?.data.execution_state?.status === "error" ||
          (checkIsEvaluator(node) &&
            node?.data.execution_state?.status === "success" &&
            (node?.data.execution_state?.outputs?.status === "error" ||
              node?.data.execution_state?.outputs?.passed === false)) ? (
            <Box color="red.500">
              <X size={iconSize} />
            </Box>
          ) : node?.data.execution_state?.status === "success" ? (
            <Box
              color={
                checkIsEvaluator(node) && node?.data.execution_state?.outputs?.status === "skipped"
                  ? "yellow.500"
                  : "green.500"
              }
            >
              <Check size={iconSize} />
            </Box>
          ) : node?.data.execution_state?.status === "skipped" ? (
            // The node sat behind a not-taken if/else branch - muted,
            // not red: skipping is the gate doing its job.
            <Box color="gray.400" data-testid="node-status-skipped">
              <MinusCircle size={iconSize} />
            </Box>
          ) : null}
        </Center>
      </Tooltip>
      {node?.data.execution_state?.status === "running" ||
      node?.data.execution_state?.status === "waiting" ? (
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
      ) : componentOnly ? (
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
      ) : (
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
