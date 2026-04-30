// eslint-disable-next-line no-restricted-imports
import { Dialog as ChakraDialog, Portal } from "@chakra-ui/react";
import * as React from "react";
import { CloseButton } from "./close-button";
import { IsolatedErrorBoundary } from "./IsolatedErrorBoundary";

interface DialogContentProps extends ChakraDialog.ContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement>;
  backdrop?: boolean;
  /** Props merged onto the default backdrop (e.g. stronger blur). */
  backdropProps?: ChakraDialog.BackdropProps;
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

  return (
    <Portal disabled={!portalled} container={portalRef}>
      {backdrop && (
        <ChakraDialog.Backdrop
          backdropFilter="blur(8px)"
          {...backdropProps}
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

export const DialogBackdrop = function DialogBackdrop(
  props: ChakraDialog.BackdropProps,
) {
  return <ChakraDialog.Backdrop {...props} />;
};

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
  Backdrop: DialogBackdrop,
  Title: DialogTitle,
  Description: DialogDescription,
  Trigger: DialogTrigger,
  ActionTrigger: DialogActionTrigger,
};
