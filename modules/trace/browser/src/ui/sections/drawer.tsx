import {
  Drawer as BaseDrawer,
  type DrawerContentProps as BaseDrawerContentProps,
} from "@langwatch/design-system/drawer";
export type { AppDrawerSize, DrawerRootProps } from "@langwatch/design-system/drawer";
import * as React from "react";

import { useLangyStore } from "../../behavior/langy/langy.store.ts";
import {
  LANGY_DOCK_GAP,
  LANGY_DODGE_STAGGER_MS,
  LANGY_TRANSITION,
  SIDEBAR_PANEL_WIDTH,
} from "../../model/langy/langy-panel-layout.ts";
import { IsolatedErrorBoundary } from "./isolated-error-boundary.tsx";

/**
 * Context to provide a margin-top offset to all Drawer.Content descendants. Used by
 * CurrentDrawer in the studio to push drawers below the header bar. Works with portaled
 * content because React context follows the React tree, not the DOM tree.
 */
const DrawerOffsetContext = React.createContext<{ marginTop?: number }>({});
export const DrawerOffsetProvider = DrawerOffsetContext.Provider;

interface DrawerContentProps extends BaseDrawerContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement>;
  offset?: BaseDrawerContentProps["padding"];
  /**
   * Set to `false` to disable the inline error boundary that wraps children. By
   * default, a render-time crash inside a drawer body shows an inline error panel — it
   * does NOT close the drawer or take down the page.
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

    // Only the DOCKED (sidebar) Langy holds the right edge as the drawer's companion;
    // the drawer then yields, sliding further left to leave the panel its slot plus a
    // strip of space between the two cards.
    // Spec: specs/langy/langy-panel-layout.feature
    const isLangyDockedCompanion = useLangyStore((s) => s.isOpen && s.panelMode === "sidebar");
    const langyYieldMarginEnd = isLangyDockedCompanion
      ? `${8 + SIDEBAR_PANEL_WIDTH + LANGY_DOCK_GAP}px`
      : undefined;

    // Floating Langy dodges to the left when a drawer opens.
    const isLangyOpenFloating = useLangyStore((s) => s.isOpen && s.panelMode === "floating");
    const [staggerBehindFloatingLangy] = React.useState(() => isLangyOpenFloating);
    const langyStaggerEnter = staggerBehindFloatingLangy
      ? {
          animationDelay: `${LANGY_DODGE_STAGGER_MS}ms`,
          animationFillMode: "backwards" as const,
        }
      : undefined;

    // Crash inside the drawer body should NOT close the drawer. Wrap the
    // children so a render error renders an inline error panel within the
    // drawer frame instead.
    const safeChildren = withErrorBoundary ? (
      <IsolatedErrorBoundary scope={errorScope}>{children}</IsolatedErrorBoundary>
    ) : (
      children
    );

    return (
      <BaseDrawer.Content
        portalled={portalled}
        portalRef={portalRef}
        offset={offset}
        ref={ref}
        {...rest}
        marginTop={marginTopProp}
        marginEnd={langyYieldMarginEnd}
        transition={`margin ${LANGY_TRANSITION}`}
        {...(langyStaggerEnter ? { _open: langyStaggerEnter } : {})}
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
