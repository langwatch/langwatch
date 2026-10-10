import {
  Box,
  Button,
  IconButton,
  HStack,
  Link,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import type { Component, Field, NodeWithOptionalPosition } from "@langwatch/workflow-contract";
import merge from "lodash-es/merge";
import { BookOpen, Box as BoxIcon, ChevronsLeft, Star, MessagesSquare } from "lucide-react";

import { useWorkflowStore } from "../../behavior/use-workflow-store.ts";
import { MODULES } from "../../model/studio-registry.ts";
import { AgentNodeDraggable } from "./workflow-agent-node-draggable.tsx";
import { EvaluatorNodeDraggable } from "./workflow-evaluator-node-draggable.tsx";
import { NodeDraggable } from "./workflow-node-draggable.tsx";

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
      position={propertiesExpanded || !isOpen ? "absolute" : "relative"}
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
            <Star size={20} />
          </PaletteLink>
          <PaletteLink href="https://discord.gg/kT4PhDS2gH" label="Join our community">
            <MessagesSquare size={20} />
          </PaletteLink>
          <PaletteLink
            href="https://docs.langwatch.ai/optimization-studio/llm-nodes"
            label="Documentation"
          >
            <BookOpen size={20} />
          </PaletteLink>
          <Spacer />
          <IconButton
            aria-label="Collapse components"
            size="sm"
            variant="ghost"
            onClick={() => setIsOpen(!isOpen)}
          >
            <ChevronsLeft size={16} />
          </IconButton>
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
