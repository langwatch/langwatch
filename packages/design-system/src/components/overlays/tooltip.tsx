import { Flex, Tooltip as ChakraTooltip, Portal, Text } from "@chakra-ui/react";
import * as React from "react";

import { OverlayDepthContext, useOverlayZIndex } from "../../overlays/depth.ts";
import { ShortcutHint, type ShortcutDefinition } from "../display/shortcut-hint.tsx";

export interface TooltipProps extends ChakraTooltip.RootProps {
  showArrow?: boolean;
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement | null>;
  content: React.ReactNode;
  contentProps?: ChakraTooltip.ContentProps;
  disabled?: boolean;
  /** A keycap hint after the content. Set aria-keyshortcuts on the real trigger. */
  shortcut?: ShortcutDefinition;
}

export const Tooltip = React.forwardRef<HTMLDivElement, TooltipProps>(function Tooltip(props, ref) {
  const {
    showArrow,
    children,
    disabled,
    portalled = true,
    content,
    contentProps,
    portalRef,
    shortcut,
    ...rest
  } = props;

  const { zIndex, depth } = useOverlayZIndex();

  if (disabled) return children;

  return (
    <ChakraTooltip.Root
      openDelay={420}
      // Interactive tooltips need a close grace period so the pointer can
      // travel across the gap from the trigger into the content to reach
      // something clickable inside, like a link. Non-interactive tooltips
      // stay snappy. An explicit closeDelay from the caller still wins.
      closeDelay={rest.interactive ? 300 : 0}
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
              node.style.setProperty("z-index", zIndex, "important");
            }
          }}
        >
          <OverlayDepthContext.Provider value={depth}>
            <ChakraTooltip.Content ref={ref} {...contentProps}>
              {showArrow && (
                <ChakraTooltip.Arrow>
                  <ChakraTooltip.ArrowTip />
                </ChakraTooltip.Arrow>
              )}
              {shortcut ? <TooltipWithShortcut content={content} shortcut={shortcut} /> : content}
            </ChakraTooltip.Content>
          </OverlayDepthContext.Provider>
        </ChakraTooltip.Positioner>
      </Portal>
    </ChakraTooltip.Root>
  );
});

export { Tooltip as RawTooltip } from "@chakra-ui/react";

function TooltipWithShortcut({
  content,
  shortcut,
}: {
  content: React.ReactNode;
  shortcut: ShortcutDefinition;
}) {
  return (
    <Flex
      align="center"
      gap={2}
      css={{
        "& kbd": { background: "transparent", color: "inherit", borderColor: "currentColor" },
      }}
    >
      <span>{content}</span>
      <ShortcutHint shortcut={shortcut} />
    </Flex>
  );
}
