import { Box, Button, HStack, Link, Spacer, Text, VStack } from "@chakra-ui/react";
import { merge } from "lodash-es";
import { BookOpen, Box as BoxIcon, ChevronsLeft, GitHub } from "react-feather";

import type { Component, Field, NodeWithOptionalPosition } from "@langwatch/workflow-contract";
import { MODULES } from "./studio-registry";
import { useWorkflowStore } from "./hooks/use-workflow-store";
import { AgentNodeDraggable } from "./workflow-agent-node-draggable";
import { EvaluatorNodeDraggable } from "./workflow-evaluator-node-draggable";
import { NodeDraggable } from "./workflow-node-draggable";

type WorkflowNodeDropAction = (item: { node: NodeWithOptionalPosition<Component> }) => void;

export type WorkflowPaletteComponent = {
  id: string;
  name?: string | null;
  publishedId: string;
  inputs: Field[];
  outputs: Field[];
};

export function LlmSignatureNodeDraggable({
  model,
  onDragEnd,
}: {
  model: string;
  onDragEnd?: WorkflowNodeDropAction;
}) {
  return (
    <NodeDraggable
      component={merge({}, MODULES.signature, {
        parameters: [
          {
            identifier: "llm",
            type: "llm",
            value: { model },
          },
        ],
      })}
      type="signature"
      onDragEnd={onDragEnd}
    />
  );
}

export function WorkflowNodeSelectionPanelButton({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}) {
  return (
    <Button
      size="sm"
      display={isOpen ? "none" : "block"}
      background="bg"
      borderRadius={4}
      borderColor="border.emphasized"
      variant="outline"
      onClick={() => setIsOpen(!isOpen)}
    >
      <HStack>
        <BoxIcon size={13} />
        <Text>Components</Text>
      </HStack>
    </Button>
  );
}

/** Reusable Workflow canvas palette. The app supplies fetched components and picker actions. */
export function WorkflowNodeSelectionPanel({
  isOpen,
  setIsOpen,
  defaultModel,
  customComponents,
  onPromptDragEnd,
  onEvaluatorDragEnd,
  onAgentDragEnd,
}: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  defaultModel: string;
  customComponents: readonly WorkflowPaletteComponent[];
  onPromptDragEnd: WorkflowNodeDropAction;
  onEvaluatorDragEnd: WorkflowNodeDropAction;
  onAgentDragEnd: WorkflowNodeDropAction;
}) {
  const { propertiesExpanded, getWorkflow } = useWorkflowStore((state) => ({
    propertiesExpanded: state.propertiesExpanded,
    getWorkflow: state.getWorkflow,
  }));
  const workflow = getWorkflow();

  return (
    <Box
      display={isOpen ? "block" : "none"}
      opacity={propertiesExpanded ? 0 : 1}
      visibility={propertiesExpanded ? "hidden" : "visible"}
      position={propertiesExpanded ? "absolute" : isOpen ? "relative" : "absolute"}
      top={0}
      left={0}
      background="bg"
      borderRight="1px solid"
      borderColor="border"
      zIndex={100}
      height="calc(100vh - 49px)"
      fontSize="14px"
      width="300px"
      minWidth="300px"
    >
      <VStack width="full" height="full" gap={0}>
        <VStack
          width="full"
          height="full"
          gap={4}
          align="start"
          overflowY="auto"
          padding={3}
          paddingBottom="56px"
        >
          <Text fontWeight="500" padding={1}>
            Components
          </Text>

          <LlmSignatureNodeDraggable model={defaultModel} onDragEnd={onPromptDragEnd} />

          <NodeDraggable component={MODULES.code} type="code" />

          <NodeDraggable component={MODULES.http} type="http" />

          <NodeDraggable component={MODULES.ifElse} type="if_else" />

          <AgentNodeDraggable onDragEnd={onAgentDragEnd} />

          <EvaluatorNodeDraggable onDragEnd={onEvaluatorDragEnd} />

          {customComponents.length > 0 && (
            <>
              <Text fontWeight="500" padding={1}>
                Custom Components
              </Text>
              {customComponents.map((customComponent) => {
                const isCurrentWorkflow = customComponent.id === workflow.workflow_id;
                return (
                  <NodeDraggable
                    key={customComponent.id}
                    component={{
                      name: customComponent.name ?? "Custom Component",
                      inputs: customComponent.inputs,
                      outputs: customComponent.outputs,
                      isCustom: true,
                      workflow_id: customComponent.id,
                      publishedId: customComponent.publishedId,
                      version_id: customComponent.publishedId,
                    }}
                    type="custom"
                    disableDrag={isCurrentWorkflow}
                  />
                );
              })}
            </>
          )}
        </VStack>
        <HStack width="full" padding={3} paddingLeft={5} gap={4} background="bg">
          <PaletteLink href="https://github.com/langwatch/langwatch" label="Star us on GitHub">
            <GitHub size={20} />
          </PaletteLink>
          <PaletteLink href="https://discord.gg/kT4PhDS2gH" label="Join our community">
            <DiscordOutlineIcon />
          </PaletteLink>
          <PaletteLink
            href="https://docs.langwatch.ai/optimization-studio/llm-nodes"
            label="Documentation"
          >
            <BookOpen size={20} />
          </PaletteLink>
          <Spacer />
          <Button size="sm" variant="ghost" onClick={() => setIsOpen(!isOpen)}>
            <ChevronsLeft size={18} />
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
}

function PaletteLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} target="_blank" aria-label={label}>
      <Box width="20px" height="20px" display="flex" alignItems="center" justifyContent="center">
        {children}
      </Box>
    </Link>
  );
}

function DiscordOutlineIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
      <path
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
        d="M19.636 3.924A18 18 0 0 0 15.097 2.5q-.321.586-.581 1.205a16.6 16.6 0 0 0-5.037 0A13 13 0 0 0 8.897 2.5a18 18 0 0 0-4.542 1.427C1.483 8.26.705 12.486 1.093 16.651A18.2 18.2 0 0 0 6.66 19.5c.45-.618.85-1.274 1.192-1.96-.65-.248-1.847-1.68-2.446-2.04.158-.116.88.89 1.03.773A12.9 12.9 0 0 0 12 17.541c1.924 0 3.824-.433 5.565-1.268.15.125.685-.88.841-.773-.6.36-1.61 1.793-2.262 2.042q.515 1.03 1.192 1.958a18.1 18.1 0 0 0 5.57-2.847c.457-4.83-.78-9.017-3.27-12.73Zm-11.29 9.165c-1.086 0-1.982-1.004-1.982-2.239s.865-2.247 1.978-2.247 2.002 1.012 1.983 2.247c-.02 1.235-.874 2.24-1.98 2.24Zm7.309 0c-1.087 0-1.98-1.004-1.98-2.239s.865-2.247 1.98-2.247 1.996 1.012 1.977 2.247-.872 2.24-1.978 2.24Z"
      />
    </svg>
  );
}
