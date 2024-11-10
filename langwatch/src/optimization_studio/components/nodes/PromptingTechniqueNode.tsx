import { NodeToolbar, type Node, type NodeProps } from "@xyflow/react";
import type { Ref } from "react";
import { forwardRef, useMemo, useState } from "react";
import type { ComponentType, PromptingTechnique } from "../../types/dsl";
import { ComponentNode, getNodeDisplayName, selectionColor } from "./Nodes";
import {
  Box,
  HStack,
  VStack,
  Text,
  MenuItem,
  MenuList,
  Menu,
  MenuButton,
} from "@chakra-ui/react";
import { useDrop } from "react-dnd";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import { ComponentIcon } from "../ColorfulBlockIcons";
import { Copy, MoreHorizontal, Trash2 } from "react-feather";

export const PromptingTechniqueDraggingNode = forwardRef(
  function PromptingTechniqueDraggingNode(
    props: NodeProps<Node<PromptingTechnique>>,
    ref: Ref<HTMLDivElement>
  ) {
    return <ComponentNode ref={ref} {...props} hideOutputHandles />;
  }
);

export const PromptingTechniqueNode = forwardRef(
  function PromptingTechniqueNode(
    _props: NodeProps<Node<PromptingTechnique>>,
    _ref: Ref<HTMLDivElement>
  ) {
    return null;
  }
);

export function PromptingTechniqueDropArea({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const [_, drop] = useDrop(() => ({
    accept: "prompting_technique",
    drop: (_item, _monitor) => {
      return { id };
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  }));

  return <Box ref={drop}>{children}</Box>;
}

export function PromptingTechniqueWrappers({
  children,
  decoratedBy,
}: {
  children: React.ReactNode;
  decoratedBy?: {
    ref: string;
  }[];
}) {
  const decorationRefs = decoratedBy?.map(({ ref }) => ref) ?? [];
  const { nodes } = useWorkflowStore((state) => ({
    nodes:
      decorationRefs.length === 0
        ? []
        : state.nodes
            .filter((node) => decorationRefs.includes(node.id))
            .sort(
              (a, b) =>
                decorationRefs.indexOf(a.id) - decorationRefs.indexOf(b.id)
            ),
  }));

  const stackedPromptingTechniques = useMemo(
    () =>
      nodes.reduce((children, node) => {
        return (
          <PromptingTechniqueWrapper key={node.id} node={node}>
            {children}
          </PromptingTechniqueWrapper>
        );
      }, children),
    [JSON.stringify(nodes), children]
  );

  if (!nodes.length) {
    return children;
  }

  return stackedPromptingTechniques;
}

export function PromptingTechniqueWrapper({
  children,
  node,
}: {
  children: React.ReactNode;
  node: Node<PromptingTechnique>;
}) {
  const { setNode, deselectAllNodes } = useWorkflowStore((state) => ({
    setNode: state.setNode,
    deselectAllNodes: state.deselectAllNodes,
  }));
  const isHovered = false;

  const { deleteNode } = useWorkflowStore((state) => ({
    deleteNode: state.deleteNode,
  }));

  return (
    <VStack
      position="relative"
      padding="2px"
      backgroundColor="#F7FAFC"
      borderRadius="12px"
      color="gray.600"
      fontSize={10}
      boxShadow={`0px 0px 4px 0px rgba(0, 0, 0, 0.1)`}
      outline={!!node.selected || isHovered ? "1.5px solid" : "none"}
      outlineColor={
        node.selected ? selectionColor : isHovered ? "gray.300" : "none"
      }
      spacing={0}
      onClick={(e) => {
        let parent: HTMLElement | null = e.target as HTMLElement;
        while (parent && !parent.classList.contains("js-component-node")) {
          parent = parent.parentElement;
        }
        if (parent) {
          return;
        }
        e.stopPropagation();
        deselectAllNodes();
        setNode({ id: node.id, selected: true });
      }}
    >
      {node.selected && (
        <Menu placement="top-start" size="xs" autoSelect={false}>
          <MenuButton
            background="white"
            position="absolute"
            top="-26px"
            right={1}
            paddingX={1}
            paddingY={1}
            borderRadius={6}
            minWidth="auto"
            minHeight="auto"
            boxShadow="sm"
          >
            <MoreHorizontal size={11} />
          </MenuButton>
          <NodeToolbar nodeId={node.id}>
            <MenuList>
              <MenuItem
                icon={<Trash2 size={14} />}
                onClick={() => {
                  deleteNode(node.id);
                }}
              >
                Delete
              </MenuItem>
            </MenuList>
          </NodeToolbar>
        </Menu>
      )}
      <HStack spacing={2} width="full" paddingX={3} paddingY={2}>
        <ComponentIcon
          type={node.type as ComponentType}
          cls={node.data.cls}
          size="sm"
        />
        <Text fontSize={12} fontWeight={500}>
          {getNodeDisplayName(node)}
        </Text>
      </HStack>
      {children}
    </VStack>
  );
}
