// eslint-disable-next-line no-restricted-imports
import { Drawer as ChakraDrawer, Portal } from "@chakra-ui/react";
import * as React from "react";
import {
  LANGY_DOCK_GAP,
  LANGY_TRANSITION,
  SIDEBAR_PANEL_WIDTH,
} from "~/features/langy/logic/langyPanelLayout";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { CloseButton } from "./close-button";
import { IsolatedErrorBoundary } from "./IsolatedErrorBoundary";

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

export const DrawerContent = React.forwardRef<
  HTMLDivElement,
  DrawerContentProps
>(function DrawerContent(props, ref) {
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

  // Only the DOCKED (sidebar) Langy holds the right edge as the drawer's
  // companion; the drawer then yields, sliding further left to leave the panel
  // its slot plus a strip of space between the two cards. The drawer keeps its
  // own slide-in, but the docked companion sits above it (higher z-index) so
  // the drawer slides in from BEHIND it. When Langy is FLOATING it dodges to
  // the left instead (see LangyPanel), so the drawer keeps the full right edge
  // and does NOT yield. Reactive, so closing the panel or switching layout
  // mid-drawer returns the drawer to the edge.
  // Spec: specs/langy/langy-panel-layout.feature
  const isLangyDockedCompanion = useLangyStore(
    (s) => s.isOpen && s.panelMode === "sidebar",
  );
  const langyYieldMarginEnd = isLangyDockedCompanion
    ? `${8 + SIDEBAR_PANEL_WIDTH + LANGY_DOCK_GAP}px`
    : undefined;

  // Floating Langy dodges to the left when a drawer opens. Hold the drawer's
  // entrance back briefly so the panel clears out FIRST and the drawer then
  // slides in behind it — the two moving in lockstep read as one clumsy jump.
  // FROZEN at mount: the drawer that triggered the dodge gets the delay; a
  // drawer opened later (panel already parked) enters normally.
  const isLangyOpenFloating = useLangyStore(
    (s) => s.isOpen && s.panelMode === "floating",
  );
  const [staggerBehindFloatingLangy] = React.useState(
    () => isLangyOpenFloating,
  );
  const langyStaggerEnter = staggerBehindFloatingLangy
    ? { animationDelay: "200ms", animationFillMode: "backwards" as const }
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
    <Portal disabled={!portalled} container={portalRef}>
      <ChakraDrawer.Positioner padding={offset} pointerEvents="none">
        <ChakraDrawer.Content
          ref={ref}
          margin={2}
          pointerEvents="auto"
          borderRadius="lg"
          background="bg.surface/80"
          backdropFilter="blur(25px)"
          {...rest}
          marginTop={marginTopProp}
          marginEnd={langyYieldMarginEnd}
          transition={`margin ${LANGY_TRANSITION}`}
          {...(langyStaggerEnter ? { _open: langyStaggerEnter } : {})}
          asChild={false}
        >
          {safeChildren}
        </ChakraDrawer.Content>
      </ChakraDrawer.Positioner>
    </Portal>
  );
});

export const DrawerCloseTrigger = React.forwardRef<
  HTMLButtonElement,
  ChakraDrawer.CloseTriggerProps
>(function DrawerCloseTrigger(props, ref) {
  return (
    <ChakraDrawer.CloseTrigger
      position="absolute"
      top="2"
      insetEnd="2"
      {...props}
      asChild
    >
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
 */
export const DrawerRoot = function DrawerRoot(props: ChakraDrawer.RootProps) {
  return (
    <ChakraDrawer.Root
      modal={false}
      closeOnInteractOutside={false}
      preventScroll={false}
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
