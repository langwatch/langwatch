// eslint-disable-next-line no-restricted-imports
import { Drawer as ChakraDrawer, Portal } from "@chakra-ui/react";
import * as React from "react";

import { CloseButton } from "./close-button";
import { StudioIsolatedErrorBoundary } from "./studio-error-boundary";

/**
 * Context to provide a margin-top offset to all Drawer.Content descendants.
 * Used by CurrentDrawer to push drawers below the header bar; works with
 * portaled content since React context follows the React tree.
 */
const DrawerOffsetContext = React.createContext<{ marginTop?: number }>({});
export const DrawerOffsetProvider = DrawerOffsetContext.Provider;

interface DrawerContentProps extends ChakraDrawer.ContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement>;
  offset?: ChakraDrawer.ContentProps["padding"];
  /**
   * Set to `false` to disable the inline error boundary wrapping children. By
   * default a render-time crash shows an inline panel, not a closed drawer.
   */
  withErrorBoundary?: boolean;
  /** Optional scope label shown by the error fallback. */
  errorScope?: string;
  /**
   * Whether this is a development build. This package cannot read the build,
   * so the composing application says; production otherwise.
   */
  isDevelopment?: boolean;
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
      isDevelopment = false,
      ...rest
    } = props;
    const { marginTop: contextMarginTop } = React.useContext(DrawerOffsetContext);

    // Apply context marginTop only if the component doesn't already have one
    const marginTopProp =
      rest.marginTop ?? (contextMarginTop ? `${contextMarginTop}px` : undefined);

    // THE LANGY CHOREOGRAPHY DID NOT TRAVEL: `@langwatch/langy-web` is
    // ungoverned and needs a stylesheet this package won't adopt globally.
    // Without it a drawer opened in the studio slides under a docked panel
    // rather than beside it.
    // Spec: specs/langy/langy-panel-layout.feature.
    const langyYieldMarginEnd = undefined;
    const langyStaggerEnter = undefined;

    // Crash inside the drawer body should NOT close the drawer. Wrap the
    // children so a render error renders an inline error panel within the
    // drawer frame instead.
    const safeChildren = withErrorBoundary ? (
      <StudioIsolatedErrorBoundary scope={errorScope} isDevelopment={isDevelopment}>
        {children}
      </StudioIsolatedErrorBoundary>
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
 * Wrapper around Chakra's Drawer.Root with safe, overridable defaults for
 * nested drawers. `size` is widened like the plain drawer's, since Chakra's
 * own recipe doesn't know the product's extra width step.
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
