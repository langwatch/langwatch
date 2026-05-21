// eslint-disable-next-line no-restricted-imports
import { Dialog as ChakraDialog, Portal } from "@chakra-ui/react";
import * as React from "react";
import { CloseButton } from "./close-button";
import { IsolatedErrorBoundary } from "./IsolatedErrorBoundary";

interface DialogContentProps extends ChakraDialog.ContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement>;
  backdrop?: boolean;
  /**
   * Props merged onto the default backdrop (e.g. stronger blur).
   *
   * Note: `bg` / `background` / `backgroundColor` are intentionally
   * stripped. The backdrop must stay transparent so only the blur is
   * visible. Chakra's default backdrop ships with `blackAlpha.500`
   * which is the dark grey overlay we never want. If you think you
   * need a coloured backdrop, you don't — change the dialog surface
   * instead.
   */
  backdropProps?: Omit<
    ChakraDialog.BackdropProps,
    "bg" | "background" | "backgroundColor"
  >;
  /** Props passed to the positioner (e.g. style for --layer-index). */
  positionerProps?: ChakraDialog.PositionerProps;
  /**
   * Set to `false` to disable the inline error boundary that wraps
   * children. By default, a render-time crash inside a dialog body shows
   * an inline error panel — it does NOT close the dialog or take down the
   * page. Opt out only if you have a more specific outer boundary already.
   */
  withErrorBoundary?: boolean;
  /** Optional scope label shown by the error fallback. */
  errorScope?: string;
}

export const DialogContent = React.forwardRef<
  HTMLDivElement,
  DialogContentProps
>(function DialogContent(props, ref) {
  const {
    children,
    portalled = true,
    portalRef,
    backdrop = true,
    backdropProps,
    positionerProps,
    withErrorBoundary = true,
    errorScope,
    ...rest
  } = props;

  // Crash inside the dialog body should NOT close the dialog. Wrap the
  // children so a render error renders an inline error panel within the
  // dialog frame instead.
  const safeChildren = withErrorBoundary ? (
    <IsolatedErrorBoundary scope={errorScope}>{children}</IsolatedErrorBoundary>
  ) : (
    children
  );

  // Strip background overrides defensively at runtime in addition to the
  // type-level Omit, in case a caller widens the type with `as any`.
  const safeBackdropProps = stripBackdropBg(backdropProps);

  return (
    <Portal disabled={!portalled} container={portalRef}>
      {backdrop && (
        <ChakraDialog.Backdrop
          backdropFilter="blur(8px)"
          {...safeBackdropProps}
          bg="transparent"
          // Stable DOM signal that the wrapper's transparency contract is
          // active. Tests assert on this attribute because Chakra resolves
          // the `bg` prop through a CSS class which jsdom cannot compute,
          // so checking computed/inline styles is unreliable. If anyone
          // removes the `bg="transparent"` line above, this attribute
          // should be removed too — the test then fails.
          data-lw-transparent-backdrop="true"
        />
      )}
      <ChakraDialog.Positioner {...positionerProps}>
        <ChakraDialog.Content
          ref={ref}
          {...rest}
          asChild={false}
        >
          {safeChildren}
        </ChakraDialog.Content>
      </ChakraDialog.Positioner>
    </Portal>
  );
});

export const DialogCloseTrigger = React.forwardRef<
  HTMLButtonElement,
  ChakraDialog.CloseTriggerProps
>(function DialogCloseTrigger(props, ref) {
  return (
    <ChakraDialog.CloseTrigger
      position="absolute"
      top="2"
      insetEnd="2"
      {...props}
      asChild
    >
      <CloseButton size="sm" ref={ref}>
        {props.children}
      </CloseButton>
    </ChakraDialog.CloseTrigger>
  );
});

export type DialogRootProps = Omit<ChakraDialog.RootProps, "size"> & {
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "5xl" | "6xl" | "cover" | "full";
};

export const DialogRoot = function DialogRoot(props: DialogRootProps) {
  return (
    <ChakraDialog.Root
      {...(props as ChakraDialog.RootProps)}
      trapFocus={false}
      preventScroll={false}
    />
  );
};

function stripBackdropBg(
  props: DialogContentProps["backdropProps"] | undefined,
): DialogContentProps["backdropProps"] | undefined {
  if (!props) return props;
  const { bg, background, backgroundColor, style, ...rest } =
    props as ChakraDialog.BackdropProps;
  const safeStyle = style
    ? { ...style, background: "transparent", backgroundColor: "transparent" }
    : undefined;
  if (
    process.env.NODE_ENV !== "production" &&
    (bg !== undefined ||
      background !== undefined ||
      backgroundColor !== undefined ||
      style?.background !== undefined ||
      style?.backgroundColor !== undefined)
  ) {
    console.warn(
      "[Dialog] backdropProps.bg/background/backgroundColor is ignored — the backdrop is always transparent so the page behind stays visible. Adjust Dialog.Content surface instead.",
    );
  }
  return {
    ...rest,
    ...(safeStyle ? { style: safeStyle } : {}),
  } as DialogContentProps["backdropProps"];
}

export const DialogFooter = ChakraDialog.Footer;
export const DialogHeader = ChakraDialog.Header;
export const DialogBody = ChakraDialog.Body;
export const DialogTitle = ChakraDialog.Title;
export const DialogDescription = ChakraDialog.Description;
export const DialogTrigger = ChakraDialog.Trigger;
export const DialogActionTrigger = ChakraDialog.ActionTrigger;

export const Dialog = {
  Root: DialogRoot,
  Content: DialogContent,
  CloseTrigger: DialogCloseTrigger,
  Footer: DialogFooter,
  Header: DialogHeader,
  Body: DialogBody,
  // `Backdrop` is intentionally NOT exported. `Dialog.Content` already
  // renders the one allowed backdrop (transparent + blur). Mounting a
  // second one stacks two overlays and reintroduces the dark grey fill
  // we explicitly do not want.
  Title: DialogTitle,
  Description: DialogDescription,
  Trigger: DialogTrigger,
  ActionTrigger: DialogActionTrigger,
};
