// eslint-disable-next-line no-restricted-imports
import { Drawer as ChakraDrawer, Portal } from "@chakra-ui/react";
import * as React from "react";
import { CloseButton } from "@langwatch/design-system/close-button";
import { IsolatedErrorBoundary } from "./isolated-error-boundary";

/**
 * Context to provide a margin-top offset to all Drawer.Content descendants.
 * Used by CurrentDrawer in the studio to push drawers below the header bar.
 * Works with portaled content because React context follows the React tree,
 * not the DOM tree.
 */
const DrawerOffsetContext = React.createContext<{ marginTop?: number }>({});
export const DrawerOffsetProvider = DrawerOffsetContext.Provider;

interface DrawerContentProps extends ChakraDrawer.ContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement>;
  offset?: ChakraDrawer.ContentProps["padding"];
  /**
   * Set to `false` to disable the inline error boundary that wraps
   * children. By default, a render-time crash inside a drawer body shows
   * an inline error panel — it does NOT close the drawer or take down the
   * page. Opt out only if you have a more specific outer boundary already.
   */
  withErrorBoundary?: boolean;
  /** Optional scope label shown by the error fallback. */
  errorScope?: string;
}

export const DrawerContent = React.forwardRef<HTMLDivElement, DrawerContentProps>(
  function DrawerContent(props, ref) {
    const {
      children,
      portalled = true,
      portalRef,
      offset,
      withErrorBoundary = true,
      errorScope,
      ...rest
    } = props;
    const { marginTop: contextMarginTop } = React.useContext(DrawerOffsetContext);

    // Apply context marginTop only if the component doesn't already have one
    const marginTopProp =
      rest.marginTop ?? (contextMarginTop ? `${contextMarginTop}px` : undefined);

    // THE LANGY CHOREOGRAPHY DID NOT TRAVEL, and it is the seventh family to
    // refuse `@langwatch/langy-web` for the same reason: it is ungoverned, so
    // every consumer compiles its source, which needs an `es2023` library and a
    // stylesheet declaration this package would have had to adopt globally.
    //
    // What was in these lines: a docked Langy sidebar held the right edge and
    // the drawer yielded a panel's width to it, and a floating Langy dodged
    // first so the two did not move in lockstep. Without them a drawer opened in
    // the studio slides to the edge under a docked panel rather than beside it.
    // Spec: specs/langy/langy-panel-layout.feature.
    const langyYieldMarginEnd = undefined;
    const langyStaggerEnter = undefined;

    // Crash inside the drawer body should NOT close the drawer. Wrap the
    // children so a render error renders an inline error panel within the
    // drawer frame instead.
    const safeChildren = withErrorBoundary ? (
      <IsolatedErrorBoundary scope={errorScope}>{children}</IsolatedErrorBoundary>
    ) : (
      children
    );

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
            {...rest}
            marginTop={marginTopProp}
            marginEnd={langyYieldMarginEnd}
            {...(langyStaggerEnter ? { _open: langyStaggerEnter } : {})}
            asChild={false}
          >
            {safeChildren}
          </ChakraDrawer.Content>
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
      <CloseButton size="sm" ref={ref} />
    </ChakraDrawer.CloseTrigger>
  );
});

/**
 * Wrapper around Chakra's Drawer.Root with safe defaults for nested drawers.
 *
 * - `modal={false}`: Prevents focus trap from stealing input in child drawers.
 * - `closeOnInteractOutside={false}`: Prevents parent from closing when
 *   interacting with a child drawer.
 * - `preventScroll={false}`: Default to allowing background scrolling.
 *
 * All defaults can be overridden by passing props explicitly.
 *
 * `size` is widened the way `@langwatch/design-system`'s drawer widens it:
 * Chakra types `size` from its OWN recipe, so a width step the product adds
 * in `system/drawer.recipe.ts` is unknown to it. The wrapper carries the
 * product's list and hands the name down, which is why a drawer sets a width
 * by name and never with a maxWidth of its own.
 */
export type AppDrawerSize = NonNullable<ChakraDrawer.RootProps["size"]> | "2xl";

export interface DrawerRootProps extends Omit<ChakraDrawer.RootProps, "size"> {
  size?: AppDrawerSize;
}

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

export const DrawerTrigger = ChakraDrawer.Trigger;
export const DrawerFooter = ChakraDrawer.Footer;
export const DrawerHeader = ChakraDrawer.Header;
export const DrawerBody = ChakraDrawer.Body;
export const DrawerDescription = ChakraDrawer.Description;
export const DrawerTitle = ChakraDrawer.Title;
export const DrawerActionTrigger = ChakraDrawer.ActionTrigger;

export const Drawer = {
  Root: DrawerRoot,
  CloseTrigger: DrawerCloseTrigger,
  Trigger: DrawerTrigger,
  Content: DrawerContent,
  Header: DrawerHeader,
  Body: DrawerBody,
  Footer: DrawerFooter,
  Description: DrawerDescription,
  Title: DrawerTitle,
  ActionTrigger: DrawerActionTrigger,
};
