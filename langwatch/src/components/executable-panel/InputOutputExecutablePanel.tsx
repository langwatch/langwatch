import { Box, VStack, mergeRefs } from "@chakra-ui/react";
import { motion } from "framer-motion";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ForwardedRef,
  type PropsWithChildren,
} from "react";

/**
 * Constants
 *
 * We use these constants so that the parent components know how
 * to interact with this component
 */
export const PANEL_ANIMATION_DURATION = 0.4;
export const PANEL_ANIMATION_DELAY = 0.1;
export const CENTER_CONTENT_BOX_ID =
  "InputOutputExecutablePanel.CenterContent.Box";

interface InputOutputExecutablePanelProps {
  children: React.ReactNode;
  isExpanded: boolean;
  onCloseExpanded: () => void;
}

const InputOutputExecutablePanelComponent = forwardRef(
  function InputOutputExecutablePanel(
    { children, isExpanded, onCloseExpanded }: InputOutputExecutablePanelProps,
    ref: ForwardedRef<HTMLDivElement>
  ) {
    let leftDrawer: React.ReactNode | null = null;
    let centerContent: React.ReactNode | null = null;
    let rightDrawer: React.ReactNode | null = null;

    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child)) {
        const type = child.type as React.ComponentType<any>;
        const displayName = type.displayName;

        if (displayName === "InputOutputExecutablePanel.LeftDrawer") {
          leftDrawer = child;
        } else if (displayName === "InputOutputExecutablePanel.CenterContent") {
          centerContent = child;
        } else if (displayName === "InputOutputExecutablePanel.RightDrawer") {
          rightDrawer = child;
        }
      }
    });

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

    /**
     * This provides a way to cleanly reset the div to its initial state
     * at the end of the animation. This prevents weird animation glitches
     * when the panel is closed and reopened with the expanded state.
     */
    const [motionKey, setMotionKey] = useState<null | number>(null);
    const handleAnimationStart = useCallback(() => {
      if (isExpanded) {
        setMotionKey(1);
      }
    }, [isExpanded, setMotionKey]);
    const handleAnimationComplete = useCallback(() => {
      if (!isExpanded) {
        setMotionKey(null);
      }
    }, [isExpanded, setMotionKey]);

    const containerRef = useRef<HTMLDivElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);

    const MotionDiv = motion.div;
    const panelWidth = boxRef.current?.offsetWidth ?? 350;
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
        width="100%"
        height="full"
        zIndex={100}
        ref={mergeRefs(ref, containerRef)}
      >
        <MotionDiv
          key={motionKey}
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
          transition={{
            duration: PANEL_ANIMATION_DURATION,
            ease: "easeInOut",
            delay: PANEL_ANIMATION_DELAY,
          }}
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
          onAnimationStart={handleAnimationStart}
          onAnimationComplete={handleAnimationComplete}
        >
          <Box
            id="InputOutputExecutablePanel.CenterContent.Box"
            ref={boxRef}
            width="full"
            height="full"
          >
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
);

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

type InputOutputExecutablePanelComponent =
  typeof InputOutputExecutablePanelComponent & {
    LeftDrawer: React.FC<Required<PropsWithChildren>>;
    CenterContent: React.FC<Required<PropsWithChildren>>;
    RightDrawer: React.FC<Required<PropsWithChildren>>;
  };

const LeftDrawer = ({ children }: { children: React.ReactNode }) => children;
LeftDrawer.displayName = "InputOutputExecutablePanel.LeftDrawer";

const CenterContent = ({ children }: { children: React.ReactNode }) => children;
CenterContent.displayName = "InputOutputExecutablePanel.CenterContent";

const RightDrawer = ({ children }: { children: React.ReactNode }) => children;
RightDrawer.displayName = "InputOutputExecutablePanel.RightDrawer";

export const InputOutputExecutablePanel = Object.assign(
  InputOutputExecutablePanelComponent,
  {
    LeftDrawer,
    CenterContent,
    RightDrawer,
  }
);
