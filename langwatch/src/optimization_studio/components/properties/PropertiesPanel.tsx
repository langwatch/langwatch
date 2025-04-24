import { Box } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useWindowSize } from "usehooks-ts";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Component, ComponentType, Signature } from "../../types/dsl";
import { InputPanel } from "../component_execution/InputPanel";
import { OutputPanel } from "../component_execution/OutputPanel";
import { BasePropertiesPanel } from "./BasePropertiesPanel";
import { EndPropertiesPanel } from "./EndPropertiesPanel";
import { CustomPropertiesPanel } from "./CustomPropertiesPanel";
import { EntryPointPropertiesPanel } from "./EntryPointPropertiesPanel";
import { EvaluatorPropertiesPanel } from "./EvaluatorPropertiesPanel";
import { PromptingTechniquePropertiesPanel } from "./PromptingTechniquePropertiesPanel";
import { RetrievePropertiesPanel } from "./RetrievePropertiesPanel";
import { SignaturePropertiesPanel } from "./llm-configs/SignaturePropertiesPanel";
import { WorkflowPropertiesPanel } from "./WorkflowPropertiesPanel";

export function PropertiesPanel() {
  const {
    selectedNode,
    workflowSelected,
    propertiesExpanded,
    setPropertiesExpanded,
  } = useWorkflowStore(
    useShallow((state) => ({
      selectedNode: state.nodes.find((n) => n.selected),
      workflowSelected: state.workflowSelected,
      propertiesExpanded: state.propertiesExpanded,
      setPropertiesExpanded: state.setPropertiesExpanded,
    }))
  );

  const ComponentPropertiesPanelMap: Record<
    ComponentType,
    React.FC<{ node: Node<Component> }>
  > = {
    entry: EntryPointPropertiesPanel as React.FC<{ node: Node<Component> }>,
    end: EndPropertiesPanel as React.FC<{ node: Node<Component> }>,
    signature: SignaturePropertiesPanel as React.FC<{ node: Node<Component> }>,
    code: BasePropertiesPanel,
    custom: CustomPropertiesPanel,
    retriever: RetrievePropertiesPanel,
    prompting_technique: PromptingTechniquePropertiesPanel,
    evaluator: EvaluatorPropertiesPanel as React.FC<{ node: Node<Component> }>,
  };

  const { width, height } = useWindowSize();

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedNode) {
      setPropertiesExpanded(false);
    }
  }, [selectedNode, setPropertiesExpanded]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isPopoverOpen =
        document.querySelector(".chakra-popover__popper") !== null;
      if (e.key === "Escape" && propertiesExpanded && !isPopoverOpen) {
        setPropertiesExpanded(false);
        e.stopPropagation();
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [propertiesExpanded, setPropertiesExpanded]);

  const MotionDiv = motion.div;

  if (!selectedNode && workflowSelected) {
    return (
      <Box
        position={propertiesExpanded ? "absolute" : "relative"}
        top={0}
        right={0}
        background="white"
        border="1px solid"
        borderColor="gray.350"
        borderTopWidth={0}
        borderBottomWidth={0}
        borderRightWidth={0}
        zIndex={100}
        height="full"
      >
        <WorkflowPropertiesPanel />
      </Box>
    );
  }

  if (!selectedNode || !width) {
    return null;
  }

  const PropertiesPanel =
    ComponentPropertiesPanelMap[selectedNode.type as ComponentType];

  const panelWidth = ref.current?.offsetWidth ?? 350;
  const halfPanelWidth = Math.round(panelWidth / 2);
  const middlePoint = Math.round(width / 2 - halfPanelWidth);
  const topPanelHeight = 49;
  const fullPanelHeight = height - topPanelHeight - 1; // don't know why -1 is needed but if we don't take it creates a body scrollbar

  // TODO: close on X if expanded

  return (
    <Box>
      <MotionDiv
        initial={{
          right: 0,
          height: `${fullPanelHeight}px`,
          marginTop: 0,
          borderRadius: 0,
          borderTopWidth: 0,
          borderBottomWidth: 0,
          borderRightWidth: 0,
          boxShadow: "0 0 0 rgba(0,0,0,0)",
        }}
        animate={{
          right: propertiesExpanded ? `${middlePoint}px` : 0,
          height: propertiesExpanded
            ? `${fullPanelHeight - 40}px`
            : `${fullPanelHeight}px`,
          marginTop: propertiesExpanded ? "20px" : 0,
          borderRadius: propertiesExpanded ? "8px" : 0,
          borderTopWidth: propertiesExpanded ? "1px" : 0,
          borderBottomWidth: propertiesExpanded ? "1px" : 0,
          borderRightWidth: propertiesExpanded ? "1px" : 0,
          boxShadow: propertiesExpanded
            ? "0 0 10px rgba(0,0,0,0.1)"
            : "0 0 0 rgba(0,0,0,0)",
        }}
        transition={{ duration: 0.4, ease: "easeInOut", delay: 0.1 }}
        style={{
          position: propertiesExpanded ? "absolute" : "relative",
          top: 0,
          right: 0,
          background: "white",
          border: "1px solid",
          borderColor: "var(--chakra-colors-gray-350)",
          zIndex: 100,
          overflowY: "auto",
        }}
      >
        <Box ref={ref}>
          <PropertiesPanel key={selectedNode.id} node={selectedNode} />
        </Box>
      </MotionDiv>
      {propertiesExpanded && (
        <>
          <Box
            className="fade-in"
            position="absolute"
            top={0}
            left={0}
            height="100%"
            width="100%"
            background="rgba(0,0,0,0.1)"
            zIndex={98}
            onClick={() => setPropertiesExpanded(false)}
          />
          <Box
            position="absolute"
            top={0}
            left={0}
            height="100%"
            width={`calc(50% - ${halfPanelWidth}px)`}
            overflow="hidden"
            zIndex={99}
          >
            <MotionDiv
              style={{
                width: "100%",
                height: "100%",
                paddingTop: "40px",
                paddingBottom: "40px",
                paddingLeft: "40px",
              }}
              initial={{ x: "110%" }}
              animate={{ x: "0%" }}
              transition={{ duration: 0.1, ease: "easeOut", delay: 0.5 }}
              // @ts-ignore
              className="js-outer-box"
              onClick={(e: React.MouseEvent<HTMLDivElement>) => {
                if (
                  (e.target as HTMLElement).classList.contains("js-outer-box")
                ) {
                  setPropertiesExpanded(false);
                }
              }}
            >
              <InputPanel node={selectedNode} />
            </MotionDiv>
          </Box>
          <Box
            position="absolute"
            top={0}
            right={0}
            height="100%"
            width={`calc(50% - ${halfPanelWidth}px)`}
            overflow="hidden"
            zIndex={99}
          >
            <MotionDiv
              style={{
                width: "100%",
                height: "100%",
                paddingTop: "40px",
                paddingBottom: "40px",
                paddingRight: "40px",
              }}
              initial={{ x: "-110%" }}
              animate={{ x: "0%" }}
              transition={{ duration: 0.1, ease: "easeOut", delay: 0.5 }}
              // @ts-ignore
              className="js-outer-box"
              onClick={(e: React.MouseEvent<HTMLDivElement>) => {
                if (
                  (e.target as HTMLElement).classList.contains("js-outer-box")
                ) {
                  setPropertiesExpanded(false);
                }
              }}
            >
              <OutputPanel node={selectedNode} />
            </MotionDiv>
          </Box>
        </>
      )}
    </Box>
  );
}
