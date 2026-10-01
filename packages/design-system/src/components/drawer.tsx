import { Drawer as ChakraDrawer, Portal } from "@chakra-ui/react";
import * as React from "react";

import { CloseButton } from "./close-button.tsx";

const DrawerOffsetContext = React.createContext<{ marginTop?: number }>({});
export const DrawerOffsetProvider = DrawerOffsetContext.Provider;

export interface DrawerContentProps extends ChakraDrawer.ContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement>;
  offset?: ChakraDrawer.ContentProps["padding"];
}

export const DrawerContent = React.forwardRef<HTMLDivElement, DrawerContentProps>(
  function DrawerContent({ portalled = true, portalRef, offset, marginTop, ...contentProps }, ref) {
    const context = React.useContext(DrawerOffsetContext);
    return (
      <Portal disabled={!portalled} container={portalRef}>
        <ChakraDrawer.Positioner padding={offset} pointerEvents="none">
          <ChakraDrawer.Content
            ref={ref}
            margin={2}
            pointerEvents="auto"
            borderRadius="lg"
            background="color-mix(in srgb, var(--chakra-colors-bg-surface) var(--lw-panel-alpha, 80%), transparent)"
            backdropFilter="var(--lw-backdrop-blur, blur(25px))"
            marginTop={marginTop ?? context.marginTop}
            {...contentProps}
          />
        </ChakraDrawer.Positioner>
      </Portal>
    );
  },
);

export const DrawerCloseTrigger = React.forwardRef<
  HTMLButtonElement,
  ChakraDrawer.CloseTriggerProps
>(function DrawerCloseTrigger(props, ref) {
  return (
    <ChakraDrawer.CloseTrigger position="absolute" top="2" insetEnd="2" {...props} asChild>
      <CloseButton ref={ref} size="sm" />
    </ChakraDrawer.CloseTrigger>
  );
});

/** Product adds custom sizes to Chakra's drawer recipe. */
export type AppDrawerSize = NonNullable<ChakraDrawer.RootProps["size"]> | "2xl";

export interface DrawerRootProps extends Omit<ChakraDrawer.RootProps, "size"> {
  size?: AppDrawerSize;
}

/** Non-modal by default so nested drawers and portalled popovers stay operable. */
export const DrawerRoot = function DrawerRoot({ size, ...props }: DrawerRootProps) {
  return (
    <ChakraDrawer.Root
      modal={false}
      closeOnInteractOutside={false}
      preventScroll={false}
      size={size as ChakraDrawer.RootProps["size"]}
      {...props}
    />
  );
};

export const Drawer = {
  Root: DrawerRoot,
  CloseTrigger: DrawerCloseTrigger,
  Trigger: ChakraDrawer.Trigger,
  Content: DrawerContent,
  Header: ChakraDrawer.Header,
  Body: ChakraDrawer.Body,
  Footer: ChakraDrawer.Footer,
  Description: ChakraDrawer.Description,
  Title: ChakraDrawer.Title,
  ActionTrigger: ChakraDrawer.ActionTrigger,
};
