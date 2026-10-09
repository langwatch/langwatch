import { Drawer as ChakraDrawer, Portal } from "@chakra-ui/react";
import * as React from "react";

import { CloseButton } from "./close-button.tsx";

const DrawerOffsetContext = React.createContext<{ marginTop?: number }>({});
export const DrawerOffsetProvider = DrawerOffsetContext.Provider;

let endInset = 0;
const endInsetListeners = new Set<() => void>();

/** The shell sets the room a docked side panel keeps on the right edge; every drawer yields it. */
export function setDrawerEndInset(px: number): void {
  if (px === endInset) return;
  endInset = px;
  for (const listener of endInsetListeners) listener();
}

export function useDrawerEndInset(): number {
  return React.useSyncExternalStore(
    (listener) => {
      endInsetListeners.add(listener);
      return () => endInsetListeners.delete(listener);
    },
    () => endInset,
    () => 0,
  );
}

export interface DrawerContentProps extends ChakraDrawer.ContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement>;
  offset?: ChakraDrawer.ContentProps["padding"];
}

export const DrawerContent = React.forwardRef<HTMLDivElement, DrawerContentProps>(
  function DrawerContent({ portalled = true, portalRef, offset, marginTop, ...contentProps }, ref) {
    const context = React.useContext(DrawerOffsetContext);
    const inset = useDrawerEndInset();
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
            marginEnd={inset > 0 ? `${inset}px` : undefined}
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

export { Drawer as RawDrawer } from "@chakra-ui/react";
