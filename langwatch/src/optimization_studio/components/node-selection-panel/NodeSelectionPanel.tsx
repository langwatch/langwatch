import {
  Box,
  Button,
  HStack,
  Icon,
  Link,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useReactFlow, type Node, type XYPosition } from "@xyflow/react";
import { useEffect, useMemo, useRef } from "react";
import { useDrag, useDragLayer } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { BookOpen, Box as BoxIcon, ChevronsLeft, GitHub } from "react-feather";
import { LuGripVertical } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { HoverableBigText } from "../../../components/HoverableBigText";
import { IconWrapper } from "../../../components/IconWrapper";
import { DiscordOutlineIcon } from "../../../components/icons/DiscordOutline";
import {
  updateCodeClassName,
  useWorkflowStore,
} from "../../hooks/useWorkflowStore";
import { MODULES } from "../../registry";
import {
  type Component,
  type ComponentType,
  type Custom,
  type Field,
} from "../../types/dsl";
import {
  findLowestAvailableName,
  getInputsOutputs,
  nameToId,
} from "../../utils/nodeUtils";
import { ComponentIcon } from "../ColorfulBlockIcons";
import { NodeComponents } from "../nodes";
import { PromptingTechniqueDraggingNode } from "../nodes/PromptingTechniqueNode";
import { Tooltip } from "../../../components/ui/tooltip";
import { NodeDraggable } from "./NodeDraggable";
import { LlmSignatureNodeDraggable } from "./LlmSignatureNodeDraggable";

export function NodeSelectionPanelButton({
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
      background="white"
      borderRadius={4}
      borderColor="gray.350"
      variant="outline"
      onClick={() => {
        setIsOpen(!isOpen);
      }}
    >
      <HStack>
        <BoxIcon size={13} />
        <Text>Components</Text>
      </HStack>
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

          <LlmSignatureNodeDraggable />

          <NodeDraggable component={MODULES.code} type="code" />

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
          gap={4}
          background="white"
        >
          <Tooltip showArrow content="Star us on GitHub">
            <Link href="https://github.com/langwatch/langwatch" target="_blank">
              <IconWrapper width="20px" height="20px">
                <GitHub />
              </IconWrapper>
            </Link>
          </Tooltip>
          <Tooltip showArrow content="Join our community">
            <Link href="https://discord.gg/kT4PhDS2gH" target="_blank">
              <IconWrapper width="20px" height="20px">
                <DiscordOutlineIcon />
              </IconWrapper>
            </Link>
          </Tooltip>
          <Tooltip showArrow content="Documentation">
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
            <ChevronsLeft size={18} />
          </Button>
        </HStack>
      </VStack>
    </Box>
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
    item: { node?: Node } | undefined;
    currentOffset: XYPosition;
  };

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (item && item.node && ref.current) {
      const { width, height } = ref.current.getBoundingClientRect();
      item.node.width = width;
      item.node.height = height;
    }
  }, [isDragging, item]);

  if (!isDragging || !item || !item.node) {
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
