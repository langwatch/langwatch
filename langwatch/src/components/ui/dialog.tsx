// eslint-disable-next-line no-restricted-imports
import { Dialog as ChakraDialog, Portal } from "@chakra-ui/react";
import * as React from "react";
import { CloseButton } from "./close-button";

interface DialogContentProps extends ChakraDialog.ContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement>;
  backdrop?: boolean;
  /** Props passed to the positioner (e.g. style for --layer-index). */
  positionerProps?: ChakraDialog.PositionerProps;
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
    positionerProps,
    ...rest
  } = props;

  return (
    <Portal disabled={!portalled} container={portalRef}>
      {backdrop && (
        <ChakraDialog.Backdrop
          backdropFilter="blur(8px)"
          background="blackAlpha.400/10"
        />
      )}
      <ChakraDialog.Positioner {...positionerProps}>
        <ChakraDialog.Content
          borderRadius="lg"
          ref={ref}
          {...rest}
          asChild={false}
        >
          {children}
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
