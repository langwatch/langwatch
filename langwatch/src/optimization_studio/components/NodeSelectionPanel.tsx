import { DragHandleIcon } from "@chakra-ui/icons";
import {
  Box,
  Button,
  HStack,
  position,
  Spacer,
  Text,
  VStack,
  Tooltip,
  Link,
} from "@chakra-ui/react";
import {
  useReactFlow,
  type Node,
  type Edge,
  type XYPosition,
} from "@xyflow/react";
import { useEffect, useMemo, useRef } from "react";
import { useDrag, useDragDropManager, useDragLayer } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { BookOpen, Box as BoxIcon, ChevronsLeft, GitHub } from "react-feather";
import { HoverableBigText } from "../../components/HoverableBigText";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { MODULES } from "../registry";
import {
  type Component,
  type ComponentType,
  type Signature,
  type Custom,
  type Field,
} from "../types/dsl";
import { findLowestAvailableName, getInputsOutputs } from "../utils/nodeUtils";
import { ComponentIcon } from "./ColorfulBlockIcons";
import { NodeComponents } from "./nodes";
import { PromptingTechniqueDraggingNode } from "./nodes/PromptingTechniqueNode";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { IconWrapper } from "../../components/IconWrapper";
import { DiscordOutlineIcon } from "../../components/icons/DiscordOutline";
import { usePublicEnv } from "../../hooks/usePublicEnv";

export function NodeSelectionPanelButton({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}) {
  return (
    <Button
      display={isOpen ? "none" : "block"}
      background="white"
      borderRadius={4}
      borderColor="gray.350"
      variant="outline"
      onClick={() => {
        setIsOpen(!isOpen);
      }}
    >
      <BoxIcon size={22} />
    </Button>
  );
}

export const NodeSelectionPanel = ({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}) => {
  const { propertiesExpanded, getWorkflow } = useWorkflowStore((state) => ({
    propertiesExpanded: state.propertiesExpanded,
    getWorkflow: state.getWorkflow,
  }));

  const workflow = getWorkflow();
  const { project } = useOrganizationTeamProject();
  const publicEnv = usePublicEnv();

  const { data: components } = api.optimization.getComponents.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!workflow?.workflow_id,
      refetchOnWindowFocus: true,
    }
  );

  const createCustomComponent = (custom: Custom) => {
    const publishedId = custom.publishedId ?? "";
    const publishedVersion = custom.versions?.find(
      (version: any) => version.id === publishedId
    );

    const { inputs, outputs } = getInputsOutputs(
      publishedVersion?.dsl.edges,
      publishedVersion?.dsl.nodes
    ) as { inputs: Field[]; outputs: Field[] };

    return {
      name: custom.name ?? "Custom Component",
      inputs: inputs,
      outputs: outputs,
      isCustom: true,
      workflow_id: custom.id,
      published_id: publishedId,
      version_id: publishedId,
    };
  };

  return (
    <Box
      display={isOpen ? "block" : "none"}
      opacity={propertiesExpanded ? 0 : 1}
      visibility={propertiesExpanded ? "hidden" : "visible"}
      position={
        propertiesExpanded ? "absolute" : isOpen ? "relative" : "absolute"
      }
      top={0}
      left={0}
      background="white"
      borderRight="1px solid"
      borderColor="gray.200"
      zIndex={100}
      height="calc(100vh - 49px)"
      fontSize="14px"
      width="300px"
      minWidth="300px"
    >
      <VStack width="full" height="full" spacing={0}>
        <VStack
          width="full"
          height="full"
          spacing={4}
          align="start"
          overflowY="auto"
          padding={3}
          paddingBottom="56px"
        >
          <Text fontWeight="500" padding={1}>
            Components
          </Text>
          {MODULES.signatures.map((signature) => {
            return (
              <NodeDraggable
                key={signature.name}
                component={signature}
                type="signature"
              />
            );
          })}

          {components &&
            components.length > 0 &&
            components.some((custom) => custom.isComponent) && (
              <>
                <Text fontWeight="500" padding={1}>
                  Custom Components
                </Text>
                {components
                  .filter((custom) => custom.isComponent)
                  .map((custom) => {
                    const isCurrentWorkflow =
                      custom.id === workflow?.workflow_id;
                    return (
                      <NodeDraggable
                        key={custom.name}
                        component={createCustomComponent(custom as Custom)}
                        type="custom"
                        disableDrag={isCurrentWorkflow}
                      />
                    );
                  })}
              </>
            )}

          <Text fontWeight="500" paddingLeft={1}>
            Prompting Techniques
          </Text>
          {MODULES.promptingTechniques.map((promptingTechnique) => {
            return (
              <NodeDraggable
                key={promptingTechnique.name}
                component={promptingTechnique}
                type="prompting_technique"
              />
            );
          })}

          <Text fontWeight="500" padding={1}>
            Retrievers
          </Text>
          {MODULES.retrievers.map((retriever) => {
            return (
              <NodeDraggable
                key={retriever.name}
                component={retriever}
                type="retriever"
              />
            );
          })}

          <Text fontWeight="500" padding={1}>
            Evaluators
          </Text>
          {MODULES.evaluators.map((evaluator) => {
            return (
              <NodeDraggable
                key={evaluator.name}
                component={evaluator}
                type="evaluator"
              />
            );
          })}
          {components &&
            components.length > 0 &&
            components.some((custom) => custom.isEvaluator) && (
              <>
                <Text fontWeight="500" padding={1}>
                  Custom Evaluators
                </Text>
                {components
                  .filter((custom) => custom.isEvaluator)
                  .map((custom) => {
                    const isCurrentWorkflow =
                      custom.id === workflow?.workflow_id;
                    return (
                      <NodeDraggable
                        key={custom.name}
                        component={createCustomComponent(custom as Custom)}
                        type="custom"
                        behave_as="evaluator"
                        disableDrag={isCurrentWorkflow}
                      />
                    );
                  })}
              </>
            )}
        </VStack>
        <HStack
          width="full"
          padding={3}
          paddingLeft={5}
          spacing={4}
          background="white"
        >
          {!publicEnv.data?.IS_ONPREM && (
            <>
              <Tooltip hasArrow gutter={16} label="Star us on GitHub">
                <Link
                  href="https://github.com/langwatch/langwatch"
                  target="_blank"
                >
                  <IconWrapper width="20px" height="20px">
                    <GitHub />
                  </IconWrapper>
                </Link>
              </Tooltip>
              <Tooltip hasArrow gutter={16} label="Join our community">
                <Link href="https://discord.gg/kT4PhDS2gH" target="_blank">
                  <IconWrapper width="20px" height="20px">
                    <DiscordOutlineIcon />
                  </IconWrapper>
                </Link>
              </Tooltip>
            </>
          )}
          <Tooltip hasArrow gutter={16} label="Documentation">
            <Link
              href="https://docs.langwatch.ai/optimization-studio/llm-nodes"
              target="_blank"
            >
              <BookOpen size={20} />
            </Link>
          </Tooltip>
          <Spacer />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsOpen(!isOpen);
            }}
          >
            {isOpen ? <ChevronsLeft size={18} /> : <BoxIcon size={18} />}
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
};

export const NodeDraggable = (props: {
  component: Component;
  type: ComponentType;
  behave_as?: "evaluator";
  disableDrag?: boolean;
}) => {
  const { setNodes, setNodeParameter, deleteNode, nodes } = useWorkflowStore(
    (state) => ({
      setWorkflow: state.setWorkflow,
      setNodes: state.setNodes,
      setNodeParameter: state.setNodeParameter,
      deleteNode: state.deleteNode,
      nodes: state.nodes,
      propertiesExpanded: state.propertiesExpanded,
    })
  );
  const { newNode } = useMemo(() => {
    const { name: newName, id: newId } = findLowestAvailableName(
      nodes,
      props.component.name ?? "Component"
    );
    const newNode = {
      id: newId,
      type: props.type,
      data: {
        ...props.component,
        name: newName,
        behave_as: props.behave_as,
      },
    };

    return { newName, newId, newNode };
  }, [props.component, props.type, nodes]);

  const { screenToFlowPosition } = useReactFlow();

  const handleSetNodes = (newNode: Node, x: number, y: number) => {
    const position = screenToFlowPosition({ x: x, y: y });

    if (newNode) {
      newNode.position = {
        x: position.x - (newNode.width ?? 0) / 2,
        y: position.y - (newNode.height ?? 0) / 2,
      };
      setNodes([...nodes, newNode]);
    }
  };

  const handleSetPromptingTechnique = (newNode: Node, id: string) => {
    if (newNode) {
      newNode.position = {
        x: 0,
        y: 0,
      };
      setNodes([...nodes, newNode]);

      const currentNode = nodes.find((node) => node.id === id);
      for (const parameter of currentNode?.data.parameters ?? []) {
        if (parameter.type === "prompting_technique") {
          if (parameter.value) {
            deleteNode((parameter.value as { ref: string }).ref);
          }
          setNodeParameter(id, {
            identifier: parameter.identifier,
            type: "prompting_technique",
            value: {
              ref: newNode.id,
            },
          });
        }
      }
    }
  };

  const [collected, drag, preview] = useDrag({
    type:
      newNode.type === "prompting_technique" ? "prompting_technique" : "node",
    item: {
      node: newNode,
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
      clientOffset: monitor.getClientOffset(),
    }),
    end: (item, monitor) => {
      const dropResult = monitor.getDropResult();

      if (item && dropResult) {
        if (item.node.type === "prompting_technique") {
          // @ts-ignore
          handleSetPromptingTechnique(item.node, dropResult.id);
        } else {
          // @ts-ignore
          handleSetNodes(item.node, dropResult.x, dropResult.y);
        }
      }
    },
  });

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  return (
    <>
      <Tooltip
        label={
          props.disableDrag
            ? "You cannot add the same component as your workflow"
            : ""
        }
      >
        <Box
          background="white"
          ref={props.disableDrag ? undefined : drag}
          borderRadius={4}
          padding={1}
          cursor={props.disableDrag ? "not-allowed" : "grab"}
          width="full"
          opacity={collected.isDragging ? 0.5 : 1}
        >
          <HStack width="full">
            <ComponentIcon
              type={props.type}
              cls={props.component.cls}
              behave_as={props.behave_as}
              size="md"
            />
            <HoverableBigText noOfLines={1}>
              {props.component.name}
            </HoverableBigText>
            <Spacer />
            <DragHandleIcon width="14px" height="14px" color="gray.350" />
          </HStack>
        </Box>
      </Tooltip>
    </>
  );
};

export function CustomDragLayer() {
  const { isDragging, item, currentOffset } = useDragLayer((monitor) => ({
    item: monitor.getItem(),
    itemType: monitor.getItemType(),
    currentOffset: monitor.getClientOffset(),
    isDragging: monitor.isDragging(),
  })) as {
    isDragging: boolean;
    item: { node: Node } | undefined;
    currentOffset: XYPosition;
  };

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (item && ref.current) {
      const { width, height } = ref.current.getBoundingClientRect();
      item.node.width = width;
      item.node.height = height;
    }
  }, [isDragging, item]);

  if (!isDragging || !item) {
    return null;
  }

  const ComponentNode =
    item.node.type === "prompting_technique"
      ? PromptingTechniqueDraggingNode
      : NodeComponents[item.node.type as ComponentType];

  return (
    <div
      style={{
        position: "fixed",
        pointerEvents: "none",
        zIndex: 200,
        left: currentOffset?.x ?? 0,
        top: currentOffset?.y ?? 0,
        transform: "translate(-50%, -50%)",
        opacity: item.node.type === "prompting_technique" ? 1 : 0.5,
      }}
    >
      <ComponentNode
        ref={ref}
        id={item.node.id}
        type={item.node.type as ComponentType}
        data={item.node.data as any}
        draggable={false}
        width={item.node.width}
        height={item.node.height}
        deletable={false}
        selectable={false}
        selected={false}
        sourcePosition={undefined}
        targetPosition={undefined}
        dragHandle={undefined}
        parentId={undefined}
        zIndex={200}
        dragging={true}
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />
    </div>
  );
}
