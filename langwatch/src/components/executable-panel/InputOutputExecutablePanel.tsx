import { Box, VStack } from "@chakra-ui/react";
import { motion } from "framer-motion";
import React, { useEffect, useRef, type PropsWithChildren } from "react";

interface InputOutputExecutablePanelProps {
  children: React.ReactNode;
  isExpanded: boolean;
  onCloseExpanded: () => void;
}

export function InputOutputExecutablePanel({
  children,
  isExpanded,
  onCloseExpanded,
}: InputOutputExecutablePanelProps) {
  const { leftDrawer, centerContent, rightDrawer } = React.Children.toArray(
    children
  ).reduce(
    (acc, child) => {
      if (React.isValidElement(child)) {
        if (
          (child.type as React.ComponentType<any>)?.displayName ===
          "InputOutputExecutablePanel.LeftDrawer"
        ) {
          acc.leftDrawer = child;
        } else if (
          (child.type as React.ComponentType<any>)?.displayName ===
          "InputOutputExecutablePanel.CenterContent"
        ) {
          acc.centerContent = child;
        } else if (
          (child.type as React.ComponentType<any>)?.displayName ===
          "InputOutputExecutablePanel.RightDrawer"
        ) {
          acc.rightDrawer = child;
        }
      }

      return acc;
    },
    { leftDrawer: null, centerContent: null, rightDrawer: null } as {
      leftDrawer: React.ReactNode | null;
      centerContent: React.ReactNode | null;
      rightDrawer: React.ReactNode | null;
    }
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isPopoverOpen =
        document.querySelector(".chakra-popover__popper") !== null;
      if (e.key === "Escape" && isExpanded && !isPopoverOpen) {
        onCloseExpanded();
        e.stopPropagation();
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isExpanded, onCloseExpanded]);

  const ref = useRef<HTMLDivElement>(null);
  const MotionDiv = motion.div;
  const containerRef = useRef<HTMLDivElement>(null);
  const panelWidth = ref.current?.offsetWidth ?? 350;
  const halfPanelWidth = Math.round(panelWidth / 2);
  const containerWidth = containerRef.current?.offsetWidth ?? 0;
  const containerHeight = containerRef.current?.offsetHeight ?? 0;
  const middlePoint = Math.round(containerWidth / 2 - halfPanelWidth);
  const topPanelHeight = 0;
  const fullPanelHeight = containerHeight - topPanelHeight - 1; // don't know why -1 is needed but if we don't take it creates a body scrollbar

  return (
    <Box
      position="absolute"
      top={0}
      right={0}
      width="full"
      height="full"
      zIndex={100}
      ref={containerRef}
    >
      <MotionDiv
        initial={{
          right: 0,
          height: containerHeight ? `${fullPanelHeight}px` : "100%",
          marginTop: 0,
          borderRadius: 0,
          borderTopWidth: 0,
          borderBottomWidth: 0,
          borderRightWidth: 0,
          boxShadow: "0 0 0 rgba(0,0,0,0)",
        }}
        animate={{
          right: isExpanded ? `${middlePoint}px` : 0,
          height: isExpanded
            ? `${fullPanelHeight - 40}px`
            : `${fullPanelHeight}px`,
          marginTop: isExpanded ? "20px" : 0,
          borderRadius: isExpanded ? "8px" : 0,
          borderTopWidth: isExpanded ? "1px" : 0,
          borderBottomWidth: isExpanded ? "1px" : 0,
          borderRightWidth: isExpanded ? "1px" : 0,
          boxShadow: isExpanded
            ? "0 0 10px rgba(0,0,0,0.1)"
            : "0 0 0 rgba(0,0,0,0)",
        }}
        transition={{ duration: 0.4, ease: "easeInOut", delay: 0.1 }}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          background: "white",
          border: "1px solid",
          borderColor: "var(--chakra-colors-gray-350)",
          zIndex: 100,
          overflowY: "auto",
        }}
      >
        <Box ref={ref} width="full" height="full">
          <VStack
            align="start"
            gap={6}
            padding={3}
            maxWidth="550px"
            width="25vw"
            minWidth="350px"
            height="full"
            overflowY="auto"
          >
            {centerContent}
          </VStack>
        </Box>
      </MotionDiv>
      {isExpanded && (
        <>
          {/* Background */}
          <Box
            className="fade-in"
            position="absolute"
            top={0}
            left={0}
            height="100%"
            width="100%"
            background="rgba(0,0,0,0.1)"
            zIndex={98}
            onClick={onCloseExpanded}
          />
          {/* Left Panel */}
          <Panel
            width={`calc(50% - ${halfPanelWidth}px)`}
            isExpanded={isExpanded}
            onCloseExpanded={onCloseExpanded}
            isLeft={true}
          >
            {leftDrawer}
          </Panel>
          {/* Right Panel */}
          <Panel
            width={`calc(50% - ${halfPanelWidth}px)`}
            isExpanded={isExpanded}
            onCloseExpanded={onCloseExpanded}
            isLeft={false}
          >
            {rightDrawer}
          </Panel>
        </>
      )}
    </Box>
  );
}

const Panel = ({
  children,
  width,
  onCloseExpanded,
  isLeft,
}: {
  width: string;
  children?: React.ReactNode;
  isExpanded: boolean;
  onCloseExpanded: () => void;
  isLeft: boolean;
}) => {
  const MotionDiv = motion.div;
  return (
    <Box
      position="absolute"
      top={0}
      left={isLeft ? 0 : "auto"}
      right={isLeft ? "auto" : 0}
      height="100%"
      width={width}
      overflow="hidden"
      zIndex={99}
    >
      <MotionDiv
        style={{
          width: "100%",
          height: "100%",
          paddingTop: "40px",
          paddingBottom: "40px",
          paddingLeft: isLeft ? "40px" : "0px",
          paddingRight: isLeft ? "0px" : "40px",
        }}
        initial={{ x: isLeft ? "110%" : "-110%" }}
        animate={{ x: "0%" }}
        transition={{ duration: 0.1, ease: "easeOut", delay: 0.5 }}
        // @ts-ignore
        className="js-outer-box"
        onClick={(e: React.MouseEvent<HTMLDivElement>) => {
          if ((e.target as HTMLElement).classList.contains("js-outer-box")) {
            onCloseExpanded();
          }
        }}
      >
        <Box
          background="white"
          height="full"
          padding={6}
          border="1px solid"
          borderColor="gray.350"
          borderRadius={isLeft ? "8px 0 0 8px" : "0 8px 8px 0"}
          borderRightWidth={0}
          boxShadow="0 0 10px rgba(0,0,0,0.05)"
          overflowY="auto"
        >
          {children}
        </Box>
      </MotionDiv>
    </Box>
  );
};

InputOutputExecutablePanel.LeftDrawer = ({
  children,
}: {
  children: React.ReactNode;
}) => children;

(
  InputOutputExecutablePanel.LeftDrawer as React.FC<PropsWithChildren>
).displayName = "InputOutputExecutablePanel.LeftDrawer";

InputOutputExecutablePanel.CenterContent = ({
  children,
}: {
  children: React.ReactNode;
}) => children;

(
  InputOutputExecutablePanel.CenterContent as React.FC<PropsWithChildren>
).displayName = "InputOutputExecutablePanel.CenterContent";

InputOutputExecutablePanel.RightDrawer = ({
  children,
}: {
  children: React.ReactNode;
}) => children;

(
  InputOutputExecutablePanel.RightDrawer as React.FC<PropsWithChildren>
).displayName = "InputOutputExecutablePanel.RightDrawer";
