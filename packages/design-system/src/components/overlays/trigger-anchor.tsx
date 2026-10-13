"use client";

import { Box } from "@chakra-ui/react";
import * as React from "react";

/** Prevents Tooltip id from clobbering Trigger's anchor lookup. Spread props, forward ref. */
export const TriggerAnchor = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<"span">
>(function TriggerAnchor({ children, ...triggerProps }, ref) {
  return (
    <Box as="span" display="inline-flex" ref={ref} {...triggerProps}>
      {children}
    </Box>
  );
});
