import { Box } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useWindowSize } from "usehooks-ts";
import { useShallow } from "zustand/react/shallow";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Component, ComponentType } from "../../types/dsl";
import { InputPanel } from "../component_execution/InputPanel";
import { OutputPanel } from "../component_execution/OutputPanel";
import { EntryPointPropertiesPanel } from "./EntryPointPropertiesPanel";
import { BasePropertiesPanel } from "./BasePropertiesPanel";
import { WorkflowPropertiesPanel } from "./WorkflowPropertiesPanel";
import { SignaturePropertiesPanel } from "./SignaturePropertiesPanel";

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
    entry: EntryPointPropertiesPanel,
    signature: SignaturePropertiesPanel,
    module: BasePropertiesPanel,
    retriever: BasePropertiesPanel,
    prompting_technique: BasePropertiesPanel,
    evaluator: BasePropertiesPanel,
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
      const isPopoverOpen = document.querySelector(".chakra-popover__popper") !== null;
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

  if (!selectedNode && workflowSelected) {
    return (
      <Box
        position="absolute"
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
  const topPanelHeight = 41;
  const fullPanelHeight = height - topPanelHeight;

  // TODO: close on X if expanded

  return (
    <Box>
      <Box
        as={motion.div}
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
        transition="0.05s ease-out"
        ref={ref}
        position="absolute"
        top={0}
        right={0}
        background="white"
        border="1px solid"
        borderColor="gray.350"
        zIndex={100}
      >
        <PropertiesPanel node={selectedNode} />
      </Box>
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
            <Box
              as={motion.div}
              width="100%"
              height="100%"
              initial={{ x: "100%" }}
              animate={{ x: "0%" }}
              transition="0.1s ease-out 0.05s"
              paddingY="40px"
              paddingLeft="40px"
              className="js-outer-box"
              onClick={(e) => {
                if (
                  (e.target as HTMLElement).classList.contains("js-outer-box")
                ) {
                  setPropertiesExpanded(false);
                }
              }}
            >
              <InputPanel node={selectedNode} />
            </Box>
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
            <Box
              as={motion.div}
              width="100%"
              height="100%"
              initial={{ x: "-100%" }}
              animate={{ x: "0%" }}
              transition="0.1s ease-out 0.05s"
              paddingY="40px"
              paddingRight="40px"
              className="js-outer-box"
              onClick={(e) => {
                if (
                  (e.target as HTMLElement).classList.contains("js-outer-box")
                ) {
                  setPropertiesExpanded(false);
                }
              }}
            >
              <OutputPanel node={selectedNode} />
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
