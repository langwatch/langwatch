import type React from "react";

import { Box, HStack, Text, VStack } from "../primitives.ts";

/**
 * The panel every suggestion list sits in: anchored under its input, lifted like the
 * other popovers of the app, with the key hints in its foot. The search bar puts its
 * grouped fields in it; a parameter line puts its names and values in it.
 */
export const SuggestionPanel: React.FC<{
  children: React.ReactNode;
  /** A control beside the key hints, when the list has one. */
  footerAction?: React.ReactNode;
  anchorX?: number;
  testId?: string;
  /**
   * The id of the list of options, when the input that owns the panel points at it with
   * `aria-controls` and `aria-activedescendant`. It lands on the box that holds the
   * rows, not on the panel, so the footer stays out of the listbox.
   */
  listboxId?: string;
}> = ({ children, footerAction, anchorX, testId, listboxId }) => (
  <Box
    position="absolute"
    top="calc(100% + 6px)"
    left={anchorX !== undefined ? `${Math.max(0, anchorX)}px` : 0}
    borderRadius="lg"
    zIndex={2050}
    minWidth="320px"
    bg="bg.panel"
    borderWidth="1px"
    borderColor="border"
    // Match the standard Chakra popover shadow (no blue accent ring,
    // no extra outer halo) — previously a custom double-ring made the
    // dropdown read as a distinct visual primitive instead of "a
    // popover anchored to the search bar". Lifts off the page with a
    // soft layered shadow exactly like the other popovers in the app.
    boxShadow="md"
    animation="suggestion-dropdown-fade 120ms ease-out"
    css={{
      "@keyframes suggestion-dropdown-fade": {
        from: { opacity: 0 },
        to: { opacity: 1 },
      },
    }}
    data-testid={testId}
  >
    <Box
      borderRadius="lg"
      overflow="hidden"
      display="flex"
      flexDirection="column"
      bg="bg.panel"
      position="relative"
    >
      <VStack
        gap={0}
        align="stretch"
        maxHeight="320px"
        overflowY="auto"
        id={listboxId}
        role={listboxId ? "listbox" : undefined}
      >
        {children}
      </VStack>
      <DropdownFooter action={footerAction} />
    </Box>
  </Box>
);

const DropdownFooter: React.FC<{ action?: React.ReactNode }> = ({ action }) => (
  <HStack
    gap={2}
    paddingX={3}
    paddingY={2}
    borderTopWidth="1px"
    borderColor="border"
    bg="bg.subtle"
    justify="space-between"
  >
    {/* ⏎ and ⇥ both accept the highlighted suggestion (see handleKey) —
        advertise Tab too so the documented affordance is discoverable
        from the dropdown itself, not just the syntax docs. */}
    <Text textStyle="2xs" color="fg.subtle">
      ↑↓ navigate · ⏎ ⇥ select · esc close
    </Text>
    {action}
  </HStack>
);
