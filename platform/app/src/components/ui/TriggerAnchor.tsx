"use client";

import { Box } from "@chakra-ui/react";
import type React from "react";

/**
 * Wraps an asChild-based Trigger (Menu/Popover/Clipboard/MenuContextTrigger)
 * so it can safely sit inside a `<Tooltip>`. Tooltip and the inner Trigger
 * are both asChild components that clone their own `id` onto the child DOM
 * node — nested directly, Tooltip's id wins and clobbers the trigger's,
 * breaking Zag's id-based anchor lookup and pinning the floating
 * menu/popover content at the page's raw top-left origin instead of the
 * trigger button. This span gives each clone its own DOM node.
 */
export const TriggerAnchor: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <Box as="span" display="inline-flex">
    {children}
  </Box>
);
