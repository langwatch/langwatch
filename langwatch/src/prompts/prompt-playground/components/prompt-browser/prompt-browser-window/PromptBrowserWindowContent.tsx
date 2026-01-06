import { Box, HStack } from "@chakra-ui/react";
import cloneDeep from "lodash.clonedeep";
import debounce from "lodash.debounce";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type DeepPartial, FormProvider } from "react-hook-form";
import { usePromptConfigForm } from "~/prompts/hooks";
import {
  type TabData,
  useDraggableTabsBrowserStore,
} from "~/prompts/prompt-playground/prompt-playground-store/DraggableTabsBrowserStore";
import type { PromptConfigFormValues } from "~/prompts/types";
import { useTabId } from "../ui/TabContext";
import { PromptBrowserHeader } from "./PromptBrowserHeader";
import { PromptMessagesEditor } from "./PromptMessagesEditor";
import { PromptTabbedSection } from "./PromptTabbedSection";

/** Height of tabs header (32px) + divider (16px) + minimum chat area (200px) */
const TABS_AND_DIVIDER_HEIGHT = 48;
const MIN_CHAT_AREA = 200;

export { useTabId } from "../ui/TabContext";

export type LayoutMode = "vertical" | "horizontal";

/** Context for sharing layout mode with nested components */
const LayoutModeContext = createContext<LayoutMode>("vertical");

/** Hook to get the current layout mode */
export const useLayoutMode = () => useContext(LayoutModeContext);

/**
 * Window content for a prompt tab.
 * Single Responsibility: Initialize form for the active tab and render header, messages, and tabbed sections.
 * @returns JSX element or null when no initial values.
 */
export function PromptBrowserWindowContent() {
  const tabId = useTabId();
  const { tab, isSingleWindow } = useDraggableTabsBrowserStore(
    ({ windows }) => {
      const allTabs = windows.flatMap((w) => w.tabs);
      return {
        tab: allTabs.find((t) => t.id === tabId),
        isSingleWindow: windows.length === 1,
      };
    },
  );
  const currentValues = tab?.data.form.currentValues;
  const versionNumber = tab?.data.meta.versionNumber;
  const initialConfigValues = useMemo(
    () => cloneDeep(currentValues),
    [currentValues],
  );

  if (!initialConfigValues) return null;

  // Use horizontal layout when there's only one window
  const layoutMode: LayoutMode = isSingleWindow ? "horizontal" : "vertical";

  // Key includes version to force remount when version changes externally (e.g., upgrade clicked)
  // This ensures react-hook-form gets fresh defaultValues
  const formKey = `${tabId}-v${versionNumber ?? 0}`;

  return (
    <PromptBrowserWindowInner
      key={formKey}
      initialConfigValues={initialConfigValues}
      tabId={tabId}
      layoutMode={layoutMode}
    />
  );
}

/**
 * PromptBrowserWindowInner component
 * Single Responsibility: Manages form state and syncs form changes with tab data.
 * @param props - Component props
 * @param props.initialConfigValues - Initial form values for the prompt configuration
 * @param props.tabId - ID of the tab to sync form data with
 * @param props.layoutMode - Layout mode: "vertical" (stacked) or "horizontal" (side-by-side)
 */
function PromptBrowserWindowInner(props: {
  initialConfigValues: DeepPartial<PromptConfigFormValues>;
  tabId: string;
  layoutMode: LayoutMode;
}) {
  const form = usePromptConfigForm(props);
  const { updateTabData } = useDraggableTabsBrowserStore(
    ({ updateTabData }) => ({
      updateTabData,
    }),
  );

  const updateTabDataDebounced = useMemo(
    () => debounce(updateTabData, 500),
    [updateTabData],
  );

  // Track version to cancel debounced updates when external upgrade happens
  const lastVersionRef = useRef(
    props.initialConfigValues?.versionMetadata?.versionNumber,
  );

  useEffect(() => {
    const newVersion =
      props.initialConfigValues?.versionMetadata?.versionNumber;
    if (newVersion !== lastVersionRef.current) {
      // Version changed externally (e.g., upgrade clicked) - cancel pending updates
      updateTabDataDebounced.cancel();
      lastVersionRef.current = newVersion;
    }
  }, [
    props.initialConfigValues?.versionMetadata?.versionNumber,
    updateTabDataDebounced,
  ]);

  useEffect(() => {
    const sub = form.methods.watch((values) => {
      updateTabDataDebounced({
        tabId: props.tabId,
        updater: (data: TabData) => ({
          ...data,
          form: { currentValues: cloneDeep(values) },
          meta: {
            ...data.meta,
            title: values.handle ?? null,
            versionNumber: values.versionMetadata?.versionNumber,
            scope: values.scope,
          },
        }),
      });
    });
    return () => sub.unsubscribe();
  }, [form.methods, props.tabId, updateTabDataDebounced]);

  // Refs for measuring content and direct DOM manipulation during drag
  const containerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const messagesWrapperRef = useRef<HTMLDivElement>(null);
  const dragHeightRef = useRef<number | null>(null);

  // State: collapsed (false = auto-expand with content, true = hidden)
  const [isCollapsed, setIsCollapsed] = useState(false);
  // When user drags, we track their preferred max-height (null = no limit, use content size)
  const [userMaxHeight, setUserMaxHeight] = useState<number | null>(null);

  const isPromptExpanded = !isCollapsed;

  // Calculate max height based on container size
  const getMaxAllowedHeight = useCallback(() => {
    if (!containerRef.current || !headerRef.current) return;
    const containerHeight = containerRef.current.clientHeight;
    const headerHeight = headerRef.current.clientHeight;
    // Leave space for tabs header + divider + minimum chat area
    const maxAllowed = Math.max(
      0,
      containerHeight - headerHeight - TABS_AND_DIVIDER_HEIGHT - MIN_CHAT_AREA,
    );
    if (maxAllowed == 0) return;
    return maxAllowed;
  }, []);

  // Handle drag with direct DOM manipulation (no React state updates during drag)
  const handlePositionChange = useCallback(
    (clientY: number) => {
      if (
        !containerRef.current ||
        !headerRef.current ||
        !messagesWrapperRef.current
      )
        return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const headerHeight = headerRef.current.clientHeight;

      // Calculate messages height based on mouse Y position
      const relativeY = clientY - containerRect.top;
      const newHeight = relativeY - headerHeight;

      // Clamp between 0 and max allowed
      const maxAllowed = getMaxAllowedHeight() ?? 0;
      const clampedHeight = Math.max(0, Math.min(maxAllowed, newHeight));

      // Store for drag end and update DOM directly (no re-render)
      dragHeightRef.current = clampedHeight;
      messagesWrapperRef.current.style.maxHeight = `${clampedHeight}px`;
    },
    [getMaxAllowedHeight],
  );

  // Commit the drag result to React state
  const handleDragEnd = useCallback(() => {
    if (dragHeightRef.current === null) return;

    const finalHeight = dragHeightRef.current;
    dragHeightRef.current = null;

    // If dragged very low (< 30px), collapse
    if (finalHeight < 30) {
      setIsCollapsed(true);
      setUserMaxHeight(null);
    } else {
      setIsCollapsed(false);
      setUserMaxHeight(finalHeight);
    }
  }, []);

  const handleToggle = useCallback(() => {
    // Clear any direct DOM styling from drag
    if (messagesWrapperRef.current) {
      messagesWrapperRef.current.style.maxHeight = "";
    }
    dragHeightRef.current = null;

    if (isPromptExpanded) {
      // Collapse
      setIsCollapsed(true);
    } else {
      // Expand - reset to auto (no manual height limit)
      setIsCollapsed(false);
      setUserMaxHeight(null);
    }
  }, [isPromptExpanded]);

  // Calculate the actual max-height for the messages area
  const messagesMaxHeight = isCollapsed
    ? 0
    : userMaxHeight !== null
      ? userMaxHeight
      : getMaxAllowedHeight();

  // Horizontal layout: side-by-side (single window mode)
  if (props.layoutMode === "horizontal") {
    return (
      <LayoutModeContext.Provider value="horizontal">
        <FormProvider {...form.methods}>
          <HStack
            ref={containerRef}
            height="full"
            width="full"
            overflow="hidden"
            gap={0}
            alignItems="stretch"
          >
            {/* Left panel: Header + Prompt */}
            <Box
              display="flex"
              flexDirection="column"
              width="50%"
              minWidth="300px"
              maxWidth="600px"
              borderRight="1px solid"
              borderColor="gray.100"
              overflow="hidden"
              boxShadow="md"
            >
              <Box
                ref={headerRef}
                flexShrink={0}
                paddingTop={3}
                paddingBottom={3}
              >
                <Box width="full" paddingX={3}>
                  <PromptBrowserHeader />
                </Box>
              </Box>
              <Box
                flex={1}
                paddingBottom={3}
                display="flex"
                flexDirection="column"
                overflow="auto"
                position="relative"
                height="full"
                minHeight={0}
              >
                <PromptMessagesEditor />
              </Box>
            </Box>

            {/* Right panel: Tabbed section (conversation/variables) */}
            <Box
              flex={1}
              display="flex"
              flexDirection="column"
              overflow="hidden"
              paddingTop={2}
            >
              <PromptTabbedSection
                layoutMode="horizontal"
                isPromptExpanded={true}
                onPositionChange={() => {}}
                onDragEnd={() => {}}
                onToggle={() => {}}
              />
            </Box>
          </HStack>
        </FormProvider>
      </LayoutModeContext.Provider>
    );
  }

  // Vertical layout: stacked (multi-window mode)
  return (
    <LayoutModeContext.Provider value="vertical">
      <FormProvider {...form.methods}>
        <Box
          ref={containerRef}
          height="full"
          width="full"
          display="flex"
          flexDirection="column"
          overflow="hidden"
        >
          {/* Header - always visible, with bottom padding for spacing from tabs when collapsed */}
          <Box ref={headerRef} flexShrink={0} paddingTop={3} paddingBottom={3}>
            <Box width="full" maxWidth="768px" margin="0 auto" paddingX={3}>
              <PromptBrowserHeader />
            </Box>
          </Box>

          {/* Prompt messages area - collapsible, auto-grows with content */}
          <Box
            ref={messagesWrapperRef}
            maxHeight={
              isCollapsed
                ? 0
                : messagesMaxHeight
                  ? `${messagesMaxHeight}px`
                  : undefined
            }
            overflow="hidden"
            position="relative"
            flexShrink={0}
            transition={isCollapsed ? "max-height 0.15s ease-out" : undefined}
          >
            <Box
              paddingBottom={2}
              width="full"
              maxWidth="768px"
              margin="0 auto"
              paddingX={3}
            >
              <PromptMessagesEditor />
            </Box>

            {/* Fade overlay at bottom */}
            {!isCollapsed && (
              <Box
                position="absolute"
                bottom={0}
                left={0}
                right={0}
                height="12px"
                background="linear-gradient(to bottom, transparent, white)"
                pointerEvents="none"
              />
            )}
          </Box>

          {/* Tabbed section with divider */}
          <PromptTabbedSection
            layoutMode="vertical"
            isPromptExpanded={isPromptExpanded}
            onPositionChange={handlePositionChange}
            onDragEnd={handleDragEnd}
            onToggle={handleToggle}
          />
        </Box>
      </FormProvider>
    </LayoutModeContext.Provider>
  );
}
