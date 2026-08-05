"use client";

import { Box } from "@chakra-ui/react";
import * as React from "react";

/**
 * Wraps an asChild-based Trigger (Menu/Popover/Clipboard/MenuContextTrigger)
 * so it can safely sit inside a `<Tooltip>`. Tooltip and the inner Trigger
 * are both asChild components that clone their own `id` onto the child DOM
 * node: nested directly, Tooltip's id wins and clobbers the trigger's,
 * breaking Zag's id-based anchor lookup and pinning the floating
 * menu/popover content at the page's raw top-left origin instead of the
 * trigger button. This span gives each clone its own DOM node.
 *
 * To be that node it has to accept the clone. `asChild` hands the trigger's
 * id, data-scope/data-part, event handlers and ref down as ordinary props, so
 * anything dropped here never reaches the DOM. Dropping them raises no error
 * and no warning: the wrapped control still renders and still looks right,
 * the tooltip just never opens. Spread the props and forward the ref.
 */
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
