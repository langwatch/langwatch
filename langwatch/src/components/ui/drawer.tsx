// eslint-disable-next-line no-restricted-imports
import { Drawer as ChakraDrawer, Portal } from "@chakra-ui/react";
import * as React from "react";
import {
  LANGY_DOCK_GAP,
  LANGY_EASE,
  LANGY_PAIR_MS,
  LANGY_STAGE_EXIT_MS,
  LANGY_TRANSITION,
  SIDEBAR_PANEL_WIDTH,
} from "~/features/langy/logic/langyPanelLayout";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useReducedMotion } from "~/hooks/useReducedMotion";
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

/**
 * True while CurrentDrawer is holding an already-closed drawer on stage for
 * the companion ride's shared exit (see CurrentDrawer): the content plays
 * the pair-out beat and goes pointer-inert, leaving together with the Langy
 * panel instead of vanishing on unmount.
 */
const DrawerExitRideContext = React.createContext(false);
export const DrawerExitRideProvider = DrawerExitRideContext.Provider;

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

  // While the Langy panel is open it HOLDS the right edge as a floating
  // companion card (see LangyPanel's drawer-companion mode); every drawer
  // yields, sliding further left to leave the panel its slot plus a strip of
  // space between the two cards. Reactive, so closing the panel mid-drawer
  // returns the drawer to the edge. Spec: specs/langy/langy-panel-layout.feature
  const isLangyOpen = useLangyStore((s) => s.isOpen);
  const reduceMotion = useReducedMotion();
  const langyYieldMarginEnd = isLangyOpen
    ? `${8 + SIDEBAR_PANEL_WIDTH + LANGY_DOCK_GAP}px`
    : undefined;

  // The companion ride's shared beats. When the panel was open as this drawer
  // mounted, the panel plays its stage-exit first, so the drawer WAITS in the
  // wings (the delay) and then enters with the panel's own pair keyframes:
  // the same fixed 100vw travel on both elements, which is what makes them
  // slide in as one unit. FROZEN at mount on purpose — were it live, the
  // panel opening beside an already-open drawer would change animation-name
  // on a settled element and visibly replay its entrance.
  const [ridesWithLangy] = React.useState(() => isLangyOpen && !reduceMotion);
  const langyPairEnter = ridesWithLangy
    ? {
        animationName: "langy-pair-slide-in",
        animationDuration: `${LANGY_PAIR_MS}ms`,
        animationTimingFunction: LANGY_EASE,
        animationDelay: `${LANGY_STAGE_EXIT_MS}ms`,
        animationFillMode: "backwards",
      }
    : undefined;
  // The exit IS live: however the ride began, a drawer closing beside the
  // open panel leaves together with it (the panel mirrors this with its
  // ride-out beat). Two paths cover the two ways drawers close: state-driven
  // roots (open=false, exit via _closed) and CurrentDrawer's unmount-driven
  // close, where the ride-exit hold below replays the same beat on the held
  // element. Closed-state declarations only apply at close time, so toggling
  // them never restarts the settled entrance.
  const langyPairExit =
    isLangyOpen && !reduceMotion
      ? {
          animationName: "langy-pair-slide-out",
          animationDuration: `${LANGY_PAIR_MS}ms`,
          animationTimingFunction: LANGY_EASE,
        }
      : undefined;
  const isExitRide = React.useContext(DrawerExitRideContext);

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
          {...(langyPairEnter ? { _open: langyPairEnter } : {})}
          {...(langyPairExit ? { _closed: langyPairExit } : {})}
          {...(isExitRide
            ? {
                pointerEvents: "none",
                css: {
                  animation: `langy-pair-slide-out ${LANGY_PAIR_MS}ms ${LANGY_EASE} forwards`,
                },
              }
            : {})}
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
