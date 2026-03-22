// eslint-disable-next-line no-restricted-imports
import { Tooltip as ChakraTooltip, Portal, Text } from "@chakra-ui/react";
import * as React from "react";
import { OVERLAY_Z_INDEX } from "./z-index";

export interface TooltipProps extends ChakraTooltip.RootProps {
  showArrow?: boolean;
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement>;
  content: React.ReactNode;
  contentProps?: ChakraTooltip.ContentProps;
  disabled?: boolean;
}

export const Tooltip = React.forwardRef<HTMLDivElement, TooltipProps>(
  function Tooltip(props, ref) {
    const {
      showArrow,
      children,
      disabled,
      portalled = true,
      content,
      contentProps,
      portalRef,
      ...rest
    } = props;

    if (disabled) return children;

    return (
      <ChakraTooltip.Root
        openDelay={420}
        closeDelay={0}
        disabled={!props.content}
        {...rest}
      >
        <ChakraTooltip.Trigger asChild={true}>
          {typeof children === "string" ? <Text>{children}</Text> : children}
        </ChakraTooltip.Trigger>
        <Portal disabled={!portalled} container={portalRef}>
          <ChakraTooltip.Positioner
            ref={(node: HTMLElement | null) => {
              if (node) {
                // Zag.js sets --z-index inline based on layer stack order, which
                // can place tooltips behind dialogs. Force it higher. See #2519.
                node.style.setProperty("z-index", OVERLAY_Z_INDEX, "important");
              }
            }}
          >
            <ChakraTooltip.Content ref={ref} {...contentProps}>
              {showArrow && (
                <ChakraTooltip.Arrow>
                  <ChakraTooltip.ArrowTip />
                </ChakraTooltip.Arrow>
              )}
              {content}
            </ChakraTooltip.Content>
          </ChakraTooltip.Positioner>
        </Portal>
      </ChakraTooltip.Root>
    );
  },
);
