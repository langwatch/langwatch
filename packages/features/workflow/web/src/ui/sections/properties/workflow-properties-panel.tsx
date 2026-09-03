import { Box } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { useEffect, useRef } from "react";
import { useWindowSize } from "usehooks-ts";
import { useShallow } from "zustand/react/shallow";
import type { Component } from "@langwatch/workflow-contract";
import { useWorkflowStore } from "../../../behavior/use-workflow-store";

export type WorkflowPropertiesPanelProps = {
  renderNodePropertiesPanel: (props: { node: Node<Component> }) => React.ReactNode;
  renderInputPanel: (props: { node: Node<Component> }) => React.ReactNode;
  renderOutputPanel: (props: { node: Node<Component> }) => React.ReactNode;
};

/** Layout shell for the expanded Studio properties panel. */
export function WorkflowPropertiesPanel({
  renderNodePropertiesPanel,
  renderInputPanel,
  renderOutputPanel,
}: WorkflowPropertiesPanelProps) {
  const { selectedNode, propertiesExpanded, setPropertiesExpanded } = useWorkflowStore(
    useShallow((state) => ({
      selectedNode: state.nodes.find((n) => n.selected),
      propertiesExpanded: state.propertiesExpanded,
      setPropertiesExpanded: state.setPropertiesExpanded,
    })),
  );
  const { width, height } = useWindowSize();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedNode) setPropertiesExpanded(false);
  }, [selectedNode, setPropertiesExpanded]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isPopoverOpen = document.querySelector(".chakra-popover__popper") !== null;
      if (event.key === "Escape" && propertiesExpanded && !isPopoverOpen) {
        setPropertiesExpanded(false);
        event.stopPropagation();
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [propertiesExpanded, setPropertiesExpanded]);

  if (!selectedNode || !width) return null;

  const panelWidth = ref.current?.offsetWidth ?? 350;
  const halfPanelWidth = Math.round(panelWidth / 2);
  const middlePoint = Math.round(width / 2 - halfPanelWidth);
  const fullPanelHeight = height - 50;
  const expanded = propertiesExpanded;
  const outerBoxProps = {
    width: "100%",
    height: "100%",
    paddingTop: "40px",
    paddingBottom: "40px",
  } as const;

  return (
    <Box>
      <Box
        style={{
          position: expanded ? "absolute" : "relative",
          top: 0,
          right: expanded ? middlePoint : 0,
          height: expanded ? fullPanelHeight - 40 : fullPanelHeight,
          marginTop: expanded ? 20 : 0,
          borderRadius: expanded ? 8 : 0,
          background: "var(--chakra-colors-bg)",
          border: "1px solid",
          borderColor: "var(--chakra-colors-border-emphasized)",
          boxShadow: expanded ? "0 0 10px rgba(0,0,0,0.1)" : undefined,
          zIndex: 100,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <Box ref={ref}>{renderNodePropertiesPanel({ node: selectedNode })}</Box>
      </Box>
      {expanded && (
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
              style={{ ...outerBoxProps, paddingLeft: "40px" }}
              className="js-outer-box"
              onClick={(event: React.MouseEvent<HTMLDivElement>) => {
                if ((event.target as HTMLElement).classList.contains("js-outer-box"))
                  setPropertiesExpanded(false);
              }}
            >
              {renderInputPanel({ node: selectedNode })}
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
              style={{ ...outerBoxProps, paddingRight: "40px" }}
              className="js-outer-box"
              onClick={(event: React.MouseEvent<HTMLDivElement>) => {
                if ((event.target as HTMLElement).classList.contains("js-outer-box"))
                  setPropertiesExpanded(false);
              }}
            >
              {renderOutputPanel({ node: selectedNode })}
            </Box>
          </Box>
        </>
      )}
    </Box>
  );
}
