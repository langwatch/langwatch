import {
  Box,
  HStack,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Text,
  VStack,
} from "@chakra-ui/react";
import { NodeToolbar, type Node, type NodeProps } from "@xyflow/react";
import type { Ref } from "react";
import { forwardRef } from "react";
import { useDrop } from "react-dnd";
import { MoreHorizontal, Trash2 } from "react-feather";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { ComponentType, PromptingTechnique } from "../../types/dsl";
import { ComponentIcon } from "../ColorfulBlockIcons";
import { ComponentNode, selectionColor } from "./Nodes";

export const PromptingTechniqueDraggingNode = forwardRef(
  function PromptingTechniqueDraggingNode(
    props: NodeProps<Node<PromptingTechnique>>,
    ref: Ref<HTMLDivElement>
  ) {
    return (
      <ComponentNode
        ref={ref}
        {...{ ...props, data: { ...props.data, name: props.data.cls } }}
        hideOutputHandles
      />
    );
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

export function PromptingTechniqueWrapper({
  children,
  decoratedBy,
}: {
  children: React.ReactNode;
  decoratedBy?: {
    ref: string;
  };
}) {
  const { node, setNode, deleteNode, deselectAllNodes } = useWorkflowStore(
    (state) => ({
      node: decoratedBy?.ref
        ? state.nodes.find((node) => node.id === decoratedBy.ref)
        : undefined,
      setNode: state.setNode,
      deleteNode: state.deleteNode,
      deselectAllNodes: state.deselectAllNodes,
    })
  );
  const isHovered = false;

  if (!node) {
    return children;
  }

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
      gap={0}
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
      <HStack gap={2} width="full" paddingX={3} paddingY={2}>
        <ComponentIcon
          type={node.type as ComponentType}
          cls={node.data.cls}
          size="sm"
        />
        <Text fontSize={12} fontWeight={500}>
          {node.data.cls}
        </Text>
      </HStack>
      {children}
    </VStack>
  );
}
