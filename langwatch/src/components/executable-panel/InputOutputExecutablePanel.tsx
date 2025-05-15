import { Box, VStack, mergeRefs } from "@chakra-ui/react";
import { motion } from "framer-motion";
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ForwardedRef,
  type PropsWithChildren,
} from "react";
import debounce from "lodash/debounce";

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

// Add interface for dimensions
interface PanelDimensions {
  containerWidth: number;
  containerHeight: number;
  panelWidth: number;
  halfPanelWidth: number;
  middlePoint: number;
  fullPanelHeight: number;
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

    // Update initial state to match our minimum values
    const [dimensions, setDimensions] = useState<PanelDimensions>({
      containerWidth: window.innerWidth, // Better initial value than 0
      containerHeight: window.innerHeight,
      panelWidth: 350,
      halfPanelWidth: 175,
      middlePoint: Math.round(window.innerWidth / 2 - 175), // Pre-calculate initial middle point
      fullPanelHeight: window.innerHeight - 1,
    });

    useLayoutEffect(() => {
      const calculateDimensions = () => {
        if (!containerRef.current || !boxRef.current) return;

        const panelWidth = Math.max(boxRef.current.offsetWidth, 350); // Ensure minimum width
        const halfPanelWidth = Math.round(panelWidth / 2);
        const containerWidth = containerRef.current.offsetWidth;
        const containerHeight = containerRef.current.offsetHeight;
        const middlePoint = Math.round(containerWidth / 2 - halfPanelWidth);
        const fullPanelHeight = containerHeight - 1;

        setDimensions({
          containerWidth,
          containerHeight,
          panelWidth,
          halfPanelWidth,
          middlePoint,
          fullPanelHeight,
        });
      };

      // Debounced version for resize events
      const debouncedCalculate = debounce(calculateDimensions, 100);

      // Calculate initial dimensions immediately
      calculateDimensions();

      // Set up ResizeObserver with debounced calculations
      const resizeObserver = new ResizeObserver(debouncedCalculate);

      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }
      if (boxRef.current) {
        resizeObserver.observe(boxRef.current);
      }

      return () => {
        resizeObserver.disconnect();
        debouncedCalculate.cancel(); // Clean up debounce
      };
    }, [isExpanded]); // Add isExpanded to deps since it affects layout

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
            height: `${dimensions.fullPanelHeight}px`, // No more ternary needed
            marginTop: 0,
            borderRadius: 0,
            borderTopWidth: 0,
            borderBottomWidth: 0,
            borderRightWidth: 0,
            boxShadow: "0 0 0 rgba(0,0,0,0)",
          }}
          animate={{
            right: isExpanded ? `${dimensions.middlePoint}px` : 0,
            height: `${dimensions.fullPanelHeight - (isExpanded ? 40 : 0)}px`, // Simplified calculation
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
              width={`calc(50% - ${dimensions.halfPanelWidth}px)`}
              isExpanded={isExpanded}
              onCloseExpanded={onCloseExpanded}
              isLeft={true}
            >
              {leftDrawer}
            </Panel>
            {/* Right Panel */}
            <Panel
              width={`calc(50% - ${dimensions.halfPanelWidth}px)`}
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
