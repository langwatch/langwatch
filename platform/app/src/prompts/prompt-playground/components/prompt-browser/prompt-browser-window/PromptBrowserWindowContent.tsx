import { Box, HStack, Skeleton, VStack } from "@chakra-ui/react";
import { cloneDeep, debounce } from "lodash-es";
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
import { PromptAuthoringSections } from "./PromptAuthoringSections";
import { PromptBrowserHeader } from "./PromptBrowserHeader";
import { PromptConversationSection } from "./PromptConversationSection";
import { PromptMessagesEditor } from "./PromptMessagesEditor";
import { PANE_BAR_MIN_HEIGHT } from "./paneBar";

/** Height of the conversation's bar (PANE_BAR_MIN_HEIGHT) + the drag divider (16px) */
const PANE_BAR_AND_DIVIDER_HEIGHT = 56;
const MIN_CHAT_AREA = 200;

/**
 * Softens the cut where the collapsible messages area meets the tabs below it.
 * A mask carries no colour of its own, so unlike the gradient it replaced it
 * cannot disagree with the surface behind it in either theme.
 */
const MESSAGES_FADE_MASK =
  "linear-gradient(to bottom, #000 0, #000 calc(100% - 14px), rgba(0, 0, 0, 0.4) calc(100% - 5px), transparent 100%)";

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

  // All hooks must run on every render — `useMemo` below used to sit
  // after an early-return for `tab?.data.loading`, which crashed React
  // with "Rendered more hooks than during the previous render" the
  // moment the loading flag flipped to false (one extra hook in the
  // next render).
  const currentValues = tab?.data.form.currentValues;
  const versionNumber = tab?.data.meta.versionNumber;
  const initialConfigValues = useMemo(
    () => cloneDeep(currentValues),
    [currentValues],
  );

  // Use horizontal layout when there's only one window
  const layoutMode: LayoutMode = isSingleWindow ? "horizontal" : "vertical";

  // Show loading skeleton while tab data is being fetched — no form initialization
  if (tab?.data.loading) {
    return <PromptTabLoadingSkeleton layoutMode={layoutMode} />;
  }

  if (!initialConfigValues) return null;

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
    return () => {
      sub.unsubscribe();
      // Flush any pending debounced write before this tab unmounts (e.g. the
      // user edited a field then immediately switched prompt tabs). Without
      // this, switching back would restore stale tab.data.
      updateTabDataDebounced.flush();
    };
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
      containerHeight -
        headerHeight -
        PANE_BAR_AND_DIVIDER_HEIGHT -
        MIN_CHAT_AREA,
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
            {/* Left panel: Header + Prompt. A panel surface with a hairline
                border, the way the traces workspace separates its panes —
                the drop shadow it used to carry was the only place in the
                product doing that, and it still left the toolbar and the
                editor reading as one undifferentiated column. */}
            <Box
              display="flex"
              flexDirection="column"
              width="50%"
              minWidth="300px"
              maxWidth="600px"
              borderRight="1px solid"
              borderColor="border.muted"
              backgroundColor="bg.panel"
              overflow="hidden"
            >
              <Box
                ref={headerRef}
                flexShrink={0}
                display="flex"
                alignItems="center"
                minHeight={PANE_BAR_MIN_HEIGHT}
                paddingX={3}
                paddingY={1}
                borderBottom="1px solid"
                borderColor="border.muted"
              >
                <PromptBrowserHeader />
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
                {/* What the prompt declares, below the messages that use it. */}
                <Box flexShrink={0} paddingX={3}>
                  <PromptAuthoringSections />
                </Box>
              </Box>
            </Box>

            {/* Right panel: the conversation. It starts flush with the left
                panel's toolbar — the padding that used to sit here pushed its
                bar down so the two panes disagreed about where the pane
                began. */}
            <Box
              flex={1}
              display="flex"
              flexDirection="column"
              overflow="hidden"
              minWidth={0}
            >
              <PromptConversationSection
                layoutMode="horizontal"
                isPromptExpanded={true}
                // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-ops for read-only display
                onPositionChange={() => {}}
                // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-ops for read-only display
                onDragEnd={() => {}}
                // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional no-ops for read-only display
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
          {/* Header - always visible, on the same hairline-separated toolbar
              as the side-by-side layout so the two layouts do not disagree
              about where the controls end and the prompt begins. */}
          <Box
            ref={headerRef}
            flexShrink={0}
            display="flex"
            alignItems="center"
            minHeight={PANE_BAR_MIN_HEIGHT}
            paddingY={1}
            borderBottom="1px solid"
            borderColor="border.muted"
          >
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
            // Scrolls rather than clips: the prompt's variables and parameters
            // sit below its messages, and this region is capped at whatever
            // room the conversation leaves. Clipping put them out of reach on
            // a short window with no way to tell they were there.
            overflowX="hidden"
            overflowY={isCollapsed ? "hidden" : "auto"}
            position="relative"
            flexShrink={0}
            transition={isCollapsed ? "max-height 0.15s ease-out" : undefined}
            // The bottom edge softens by fading the messages themselves rather
            // than painting a gradient of the surface colour over them, so it
            // stays right whatever the surface behind it is.
            css={{
              maskImage: MESSAGES_FADE_MASK,
              WebkitMaskImage: MESSAGES_FADE_MASK,
            }}
          >
            <Box
              paddingTop={2}
              paddingBottom={2}
              width="full"
              maxWidth="768px"
              margin="0 auto"
              paddingX={3}
            >
              <PromptMessagesEditor />
              {/* What the prompt declares, below the messages that use it. */}
              <PromptAuthoringSections />
            </Box>
          </Box>

          {/* The conversation, with the handle that resizes the prompt above it */}
          <PromptConversationSection
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

/**
 * Loading skeleton displayed while a tab's data is being fetched.
 * Shows placeholder content on both prompt and chat/variables panels.
 */
function PromptTabLoadingSkeleton({ layoutMode }: { layoutMode: LayoutMode }) {
  const skeletonLines = (
    <VStack gap={3} width="full" padding={4} alignItems="flex-start">
      <Skeleton height="20px" width="40%" />
      <Skeleton height="80px" width="full" />
      <Skeleton height="20px" width="70%" />
      <Skeleton height="20px" width="55%" />
    </VStack>
  );

  const rightSkeletonLines = (
    <VStack gap={3} width="full" padding={4} alignItems="flex-start">
      <Skeleton height="20px" width="30%" />
      <Skeleton height="40px" width="80%" />
      <Skeleton height="40px" width="60%" />
    </VStack>
  );

  if (layoutMode === "horizontal") {
    return (
      <HStack height="full" width="full" gap={0} alignItems="stretch">
        <Box
          width="50%"
          minWidth="300px"
          maxWidth="600px"
          borderRight="1px solid"
          borderColor="border.muted"
          display="flex"
          flexDirection="column"
        >
          {skeletonLines}
        </Box>
        <Box flex={1} display="flex" flexDirection="column">
          {rightSkeletonLines}
        </Box>
      </HStack>
    );
  }

  return (
    <VStack height="full" width="full" gap={0} alignItems="stretch">
      <Box width="full" maxWidth="768px" paddingX={3}>
        {skeletonLines}
      </Box>
      <Box width="full" maxWidth="768px" paddingX={3}>
        {rightSkeletonLines}
      </Box>
    </VStack>
  );
}
