import { Button, Drawer as ChakraDrawer, HStack, Portal, Spacer } from "@chakra-ui/react";
import * as React from "react";

import { FieldLayoutProvider } from "../forms/field-layout.ts";
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

/**
 * The panel's ground, border and radius are the recipe's: don't pass `bg`, `background` or
 * `borderRadius` (lint proposal `no-drawer-content-ground`). Width comes from Root's `size`.
 */
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
        <FieldLayoutProvider value="stacked">
          <ChakraDrawer.Positioner padding={offset} pointerEvents="none">
            <ChakraDrawer.Content
              ref={ref}
              margin={2}
              pointerEvents="auto"
              borderRadius="lg"
              marginTop={
                marginTop ?? (context.marginTop == null ? void 0 : `${context.marginTop}px`)
              }
              marginEnd={inset > 0 ? `${inset}px` : undefined}
              {...contentProps}
            />
          </ChakraDrawer.Positioner>
        </FieldLayoutProvider>
      </Portal>
    );
  },
);

export const DrawerCloseTrigger = React.forwardRef<
  HTMLButtonElement,
  ChakraDrawer.CloseTriggerProps
>(function DrawerCloseTrigger(props, ref) {
  return (
    <ChakraDrawer.CloseTrigger position="absolute" top="3" insetEnd="3" {...props} asChild>
      <CloseButton ref={ref} size="sm" />
    </ChakraDrawer.CloseTrigger>
  );
});

export interface DrawerActionsProps {
  /** The one primary action, rightmost: `<Button colorPalette="orange" type="submit">`. */
  primary?: React.ReactNode;
  /** Closes the drawer by default; pass it when closing goes through the router. */
  onCancel?: () => void;
  cancelLabel?: string;
  /** Disables Cancel while a save is in flight (ADR-018: Save is disabled only then too). */
  busy?: boolean;
  /** A secondary action on the left edge: Delete, Duplicate, Test connection. */
  start?: React.ReactNode;
  /**
   * Takes Cancel's place: a second outline action beside the primary, for a drawer that keeps
   * a draft and never closes on its footer (the studio's Save beside Apply). No Cancel then.
   */
  secondary?: React.ReactNode;
  /**
   * Only the row, without the footer around it: for a host that draws the footer itself and
   * may show it outside the drawer (the studio's expanded view). Outside a drawer, pass
   * `secondary` or `onCancel`, since the default Cancel closes the drawer it sits in.
   */
  bare?: boolean;
}

/** The drawer's footer row: `start` on the left, then Cancel (outline) and the primary. */
export function DrawerActions({
  primary,
  onCancel,
  cancelLabel = "Cancel",
  busy = false,
  start,
  secondary,
  bare = false,
}: DrawerActionsProps) {
  const row = (
    <HStack width="full" gap={2}>
      {start}
      <Spacer />
      {secondary ?? <DrawerCancel onCancel={onCancel} cancelLabel={cancelLabel} busy={busy} />}
      {primary}
    </HStack>
  );
  return bare ? row : <ChakraDrawer.Footer>{row}</ChakraDrawer.Footer>;
}

function DrawerCancel({
  onCancel,
  cancelLabel,
  busy,
}: Required<Pick<DrawerActionsProps, "cancelLabel" | "busy">> &
  Pick<DrawerActionsProps, "onCancel">) {
  const cancel = (
    <Button variant="outline" onClick={onCancel} disabled={busy}>
      {cancelLabel}
    </Button>
  );
  if (onCancel) return cancel;
  return <ChakraDrawer.ActionTrigger asChild>{cancel}</ChakraDrawer.ActionTrigger>;
}

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
  /** The standard footer: Cancel and one primary. Prefer it to a hand-built Footer. */
  Actions: DrawerActions,
  Description: ChakraDrawer.Description,
  /** Styled by the recipe; never restyle it (fontSize, fontWeight). */
  Title: ChakraDrawer.Title,
  ActionTrigger: ChakraDrawer.ActionTrigger,
};

export { Drawer as RawDrawer } from "@chakra-ui/react";
