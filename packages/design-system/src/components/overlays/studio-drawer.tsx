import type { Drawer as ChakraDrawer } from "@chakra-ui/react";
import * as React from "react";

import { StudioIsolatedErrorBoundary } from "../states/studio-error-boundary.tsx";
import { Drawer as BaseDrawer } from "./drawer.tsx";
export type { AppDrawerSize, DrawerRootProps } from "./drawer.tsx";

export { DrawerOffsetProvider } from "./drawer.tsx";

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
      <BaseDrawer.Content
        ref={ref}
        portalled={portalled}
        portalRef={portalRef}
        offset={offset}
        {...rest}
        asChild={false}
      >
        {safeChildren}
      </BaseDrawer.Content>
    );
  },
);

export const DrawerCloseTrigger = BaseDrawer.CloseTrigger;
export const DrawerRoot = BaseDrawer.Root;

export const DrawerTrigger = BaseDrawer.Trigger;
export const DrawerFooter = BaseDrawer.Footer;
export const DrawerHeader = BaseDrawer.Header;
export const DrawerBody = BaseDrawer.Body;
export const DrawerDescription = BaseDrawer.Description;
export const DrawerTitle = BaseDrawer.Title;
export const DrawerActionTrigger = BaseDrawer.ActionTrigger;

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
