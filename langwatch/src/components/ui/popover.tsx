import { Popover as ChakraPopover, Portal } from "@chakra-ui/react";
import * as React from "react";
import { CloseButton } from "./close-button";

interface PopoverContentProps extends ChakraPopover.ContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement>;
  positionerProps?: ChakraPopover.PositionerProps;
}

export const PopoverContent = React.forwardRef<
  HTMLDivElement,
  PopoverContentProps
>(function PopoverContent(props, ref) {
  const { portalled = true, portalRef, positionerProps, ...rest } = props;
  return (
    <Portal disabled={!portalled} container={portalRef}>
      <ChakraPopover.Positioner
        {...positionerProps}
        ref={(node: HTMLElement | null) => {
          if (node) {
            // Zag.js sets --z-index inline based on layer stack order, which
            // can place popovers behind drawers. Force it higher. See #2390.
            node.style.setProperty("z-index", "2000", "important");
          }
        }}
      >
        <ChakraPopover.Content
          borderRadius="lg"
          background="bg.panel/75"
          backdropFilter="blur(8px)"
          ref={ref}
          {...rest}
        />
      </ChakraPopover.Positioner>
    </Portal>
  );
});

export const PopoverArrow = React.forwardRef<
  HTMLDivElement,
  ChakraPopover.ArrowProps
>(function PopoverArrow(props, ref) {
  return (
    <ChakraPopover.Arrow
      {...props}
      ref={ref}
      css={{ "--arrow-size": "12px", "--arrow-background": "var(--popover-bg)" }}
    >
      <ChakraPopover.ArrowTip />
    </ChakraPopover.Arrow>
  );
});

export const PopoverArrowTip = ChakraPopover.ArrowTip;

export const PopoverCloseTrigger = React.forwardRef<
  HTMLButtonElement,
  ChakraPopover.CloseTriggerProps
>(function PopoverCloseTrigger(props, ref) {
  return (
    <ChakraPopover.CloseTrigger
      position="absolute"
      top="1"
      insetEnd="1"
      {...props}
      asChild
      ref={ref}
    >
      <CloseButton size="sm" />
    </ChakraPopover.CloseTrigger>
  );
});

export const PopoverTitle = ChakraPopover.Title;
export const PopoverDescription = ChakraPopover.Description;
export const PopoverFooter = ChakraPopover.Footer;
export const PopoverHeader = ChakraPopover.Header;
export const PopoverRoot = ChakraPopover.Root;
export const PopoverBody = ChakraPopover.Body;
export const PopoverTrigger = ChakraPopover.Trigger;
export const PopoverAnchor = ChakraPopover.Anchor;

export const Popover = {
  Root: PopoverRoot,
  Content: PopoverContent,
  Arrow: PopoverArrow,
  CloseTrigger: PopoverCloseTrigger,
  Title: PopoverTitle,
  Description: PopoverDescription,
  Footer: PopoverFooter,
  Header: PopoverHeader,
  Body: PopoverBody,
  Trigger: PopoverTrigger,
  ArrowTip: PopoverArrowTip,
  Anchor: PopoverAnchor,
};
