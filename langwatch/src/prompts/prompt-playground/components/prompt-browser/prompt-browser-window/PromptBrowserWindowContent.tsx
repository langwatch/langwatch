import { Box } from "@chakra-ui/react";
import cloneDeep from "lodash.clonedeep";
import debounce from "lodash.debounce";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/**
 * Window content for a prompt tab.
 * Single Responsibility: Initialize form for the active tab and render header, messages, and tabbed sections.
 * @returns JSX element or null when no initial values.
 */
export function PromptBrowserWindowContent() {
  const tabId = useTabId();
  const tab = useDraggableTabsBrowserStore(({ windows }) =>
    windows.flatMap((w) => w.tabs).find((t) => t.id === tabId),
  );
  const currentValues = tab?.data.form.currentValues;
  const initialConfigValues = useMemo(
    () => cloneDeep(currentValues),
    [currentValues],
  );

  if (!initialConfigValues) return null;

  return (
    <PromptBrowserWindowInner
      initialConfigValues={initialConfigValues}
      tabId={tabId}
    />
  );
}

/**
 * PromptBrowserWindowInner component
 * Single Responsibility: Manages form state and syncs form changes with tab data.
 * @param props - Component props
 * @param props.initialConfigValues - Initial form values for the prompt configuration
 * @param props.tabId - ID of the tab to sync form data with
 */
function PromptBrowserWindowInner(props: {
  initialConfigValues: DeepPartial<PromptConfigFormValues>;
  tabId: string;
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
    if (!containerRef.current || !headerRef.current) return 400;
    const containerHeight = containerRef.current.clientHeight;
    const headerHeight = headerRef.current.clientHeight;
    // Leave space for tabs header + divider + minimum chat area
    return Math.max(
      0,
      containerHeight - headerHeight - TABS_AND_DIVIDER_HEIGHT - MIN_CHAT_AREA,
    );
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
      const maxAllowed = getMaxAllowedHeight();
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

  return (
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
        <Box ref={headerRef} flexShrink={0} paddingTop={0} paddingBottom={3}>
          <Box width="full" maxWidth="768px" margin="0 auto" paddingX={3}>
            <PromptBrowserHeader />
          </Box>
        </Box>

        {/* Prompt messages area - collapsible, auto-grows with content */}
        <Box
          ref={messagesWrapperRef}
          maxHeight={isCollapsed ? 0 : `${messagesMaxHeight}px`}
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
              height="30px"
              background="linear-gradient(to bottom, transparent, white)"
              pointerEvents="none"
            />
          )}
        </Box>

        {/* Tabbed section with divider */}
        <PromptTabbedSection
          isPromptExpanded={isPromptExpanded}
          onPositionChange={handlePositionChange}
          onDragEnd={handleDragEnd}
          onToggle={handleToggle}
        />
      </Box>
    </FormProvider>
  );
}
