import { Box, Button, HStack } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { motion } from "motion/react";
import type React from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Columns, X } from "react-feather";
import { useWindowSize } from "usehooks-ts";
import { useShallow } from "zustand/react/shallow";
import { HoverableBigText } from "~/components/HoverableBigText";
import { Drawer } from "~/components/ui/drawer";
import { useWorkflowStore } from "../../hooks/useWorkflowStore";
import type { Component, ComponentType } from "../../types/dsl";
import { ComponentIcon } from "../ColorfulBlockIcons";
import { InputPanel } from "../component_execution/InputPanel";
import { OutputPanel } from "../component_execution/OutputPanel";
import {
  ComponentExecutionButton,
  getNodeDisplayName,
} from "../nodes/Nodes";
import { DrawerFooterContext } from "./useInsideDrawer";

/**
 * Determines whether a node type supports the expand (Input/Output panels)
 * and play (execution) controls. Entry and end nodes are structural
 * and cannot be executed individually.
 */
function isExpandableNode(node: Pick<Node<Component>, "type">): boolean {
  return node.type !== "entry" && node.type !== "end";
}

export type StudioDrawerWrapperProps = {
  /** The currently selected ReactFlow node. When undefined the drawer is closed. */
  node: Node<Component> | undefined;
  /** Content rendered inside the drawer body. */
  children: React.ReactNode;
  /** Called when the drawer should close (e.g. close button or backdrop click). */
  onClose: () => void;
  /** Content rendered in the drawer footer (e.g. Apply/Save/Discard buttons) */
  footer?: React.ReactNode;
};

/**
 * StudioDrawerWrapper -- reusable drawer shell for the optimization studio.
 *
 * Renders a right-side Drawer that mirrors the header controls from
 * BasePropertiesPanel (play / expand / close) and, when expanded,
 * shows the InputPanel on the left and OutputPanel on the right with
 * a Framer Motion animation identical to PropertiesPanel.
 */
export function StudioDrawerWrapper({
  node,
  children,
  onClose,
  footer,
}: StudioDrawerWrapperProps) {
  const {
    deselectAllNodes,
    propertiesExpanded,
    setPropertiesExpanded,
  } = useWorkflowStore(
    useShallow((state) => ({
      deselectAllNodes: state.deselectAllNodes,
      propertiesExpanded: state.propertiesExpanded,
      setPropertiesExpanded: state.setPropertiesExpanded,
    })),
  );

  // Footer registered by child components via useRegisterDrawerFooter
  const [registeredFooter, setRegisteredFooter] =
    useState<React.ReactNode>(null);
  const effectiveFooter = footer ?? registeredFooter;

  const isOpen = node !== undefined;
  const showControls = node !== undefined && isExpandableNode(node);

  // Collapse the expanded view when the node is deselected.
  useEffect(() => {
    if (!node) {
      setPropertiesExpanded(false);
    }
  }, [node, setPropertiesExpanded]);

  // Allow Escape to collapse the expanded view before closing.
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

  const handleClose = () => {
    if (propertiesExpanded) {
      setPropertiesExpanded(false);
    } else {
      deselectAllNodes();
      onClose();
    }
  };

  // ---------- Expanded-mode layout measurements ----------
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  // Fixed width for the center panel to ensure consistent sizing
  // regardless of content (evaluator vs prompt drawers)
  const panelWidth = 512;
  const halfPanelWidth = Math.round(panelWidth / 2);
  const middlePoint = Math.round((windowWidth ?? 0) / 2 - halfPanelWidth);
  const topPanelHeight = 49;
  const fullPanelHeight = (windowHeight ?? 0) - topPanelHeight - 1;

  const MotionDiv = motion.div;

  // ----- Shared header JSX (used in both drawer and expanded modes) -----
  const headerContent = node ? (
    <HStack width="full" justify="space-between" gap={0}>
      {/* Left: icon + name */}
      <HStack gap={2} overflow="hidden" flex={1} minWidth={0}>
        <ComponentIcon
          type={node.type as ComponentType}
          cls={node.data.cls}
          size="lg"
        />
        <HoverableBigText
          lineClamp={2}
          fontSize="15px"
          fontWeight={500}
          overflow="hidden"
          textOverflow="ellipsis"
          expandable={false}
        >
          {getNodeDisplayName(node)}
        </HoverableBigText>
      </HStack>

      {/* Right: action buttons */}
      <HStack gap={0} flexShrink={0}>
        {showControls && (
          <>
            <ComponentExecutionButton
              node={node}
              size="sm"
              iconSize={16}
            />

            <Button
              variant="ghost"
              size="sm"
              color="fg.muted"
              onClick={() =>
                setPropertiesExpanded(!propertiesExpanded)
              }
            >
              <Columns size={16} />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          color="fg.muted"
          onClick={handleClose}
        >
          <X size={16} />
        </Button>
      </HStack>
    </HStack>
  ) : null;

  return (
    <>
      {/* ----- Normal drawer mode (closed when expanded) ----- */}
      <Drawer.Root
        open={isOpen && !propertiesExpanded}
        onOpenChange={({ open }) => {
          if (!open) handleClose();
        }}
        size="lg"
        closeOnInteractOutside={false}
        modal={false}
      >
        <Drawer.Content>
          {node && (
            <Drawer.Header paddingY={2} paddingX={3}>
              {headerContent}
            </Drawer.Header>
          )}

          <Drawer.Body
            display="flex"
            flexDirection="column"
            overflow="auto"
            padding={0}
          >
            <DrawerFooterContext.Provider value={setRegisteredFooter}>
              {children}
            </DrawerFooterContext.Provider>
          </Drawer.Body>

          {effectiveFooter && (
            <Drawer.Footer
              borderTopWidth="1px"
              borderColor="gray.200"
              paddingX={4}
              paddingY={3}
            >
              {effectiveFooter}
            </Drawer.Footer>
          )}
        </Drawer.Content>
      </Drawer.Root>

      {/* ----- Expanded mode: entire drawer rendered via portal ----- */}
      {propertiesExpanded &&
        node &&
        createPortal(
          <Box
            position="fixed"
            top={`${topPanelHeight}px`}
            left={0}
            width="100vw"
            height={`${fullPanelHeight}px`}
            zIndex={1500}
          >
            {/* Centre panel: full drawer (header + body + footer) as one unit */}
            <MotionDiv
              initial={{
                right: 0,
                height: `${fullPanelHeight}px`,
                marginTop: 0,
                borderRadius: 0,
                boxShadow: "0 0 0 rgba(0,0,0,0)",
              }}
              animate={{
                right: `${middlePoint}px`,
                height: `${fullPanelHeight - 40}px`,
                marginTop: "20px",
                borderRadius: "8px",
                boxShadow: "0 0 10px rgba(0,0,0,0.1)",
              }}
              transition={{ duration: 0.4, ease: "easeInOut", delay: 0.1 }}
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: `${panelWidth}px`,
                display: "flex",
                flexDirection: "column",
                background: "white",
                border: "1px solid",
                borderColor: "var(--chakra-colors-gray-350)",
                zIndex: 100,
                overflow: "hidden",
              }}
            >
              {/* Header */}
              <Box
                paddingY={2}
                paddingX={3}
                borderBottomWidth="1px"
                borderColor="gray.200"
                flexShrink={0}
              >
                {headerContent}
              </Box>

              {/* Body */}
              <Box
                flex={1}
                overflowY="auto"
                overflowX="hidden"
              >
                <DrawerFooterContext.Provider value={setRegisteredFooter}>
                  {children}
                </DrawerFooterContext.Provider>
              </Box>

              {/* Footer */}
              {effectiveFooter && (
                <Box
                  borderTopWidth="1px"
                  borderColor="gray.200"
                  paddingX={4}
                  paddingY={3}
                  flexShrink={0}
                >
                  {effectiveFooter}
                </Box>
              )}
            </MotionDiv>

            {/* Backdrop */}
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

            {/* Input panel (left) */}
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
                    (e.target as HTMLElement).classList.contains(
                      "js-outer-box"
                    )
                  ) {
                    setPropertiesExpanded(false);
                  }
                }}
              >
                <InputPanel node={node} />
              </MotionDiv>
            </Box>

            {/* Output panel (right) */}
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
                    (e.target as HTMLElement).classList.contains(
                      "js-outer-box"
                    )
                  ) {
                    setPropertiesExpanded(false);
                  }
                }}
              >
                <OutputPanel node={node} />
              </MotionDiv>
            </Box>
          </Box>,
          document.body
        )}
    </>
  );
}
