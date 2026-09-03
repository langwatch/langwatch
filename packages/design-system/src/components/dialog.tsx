import { Dialog as ChakraDialog, Portal } from "@chakra-ui/react";
import * as React from "react";
import { CloseButton } from "./close-button";

export type DialogRootProps = Omit<ChakraDialog.RootProps, "size"> & {
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "5xl" | "6xl" | "cover" | "full";
};

export function DialogRoot(props: DialogRootProps) {
  return <ChakraDialog.Root {...(props as ChakraDialog.RootProps)} />;
}

export interface DialogContentProps extends ChakraDialog.ContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement>;
  backdrop?: boolean;
  backdropProps?: Omit<
    ChakraDialog.BackdropProps,
    "bg" | "background" | "backgroundColor"
  >;
  positionerProps?: ChakraDialog.PositionerProps;
}

export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  function DialogContent(
    {
      portalled = true,
      portalRef,
      backdrop = true,
      backdropProps,
      positionerProps,
      ...contentProps
    },
    ref,
  ) {
    return (
      <Portal disabled={!portalled} container={portalRef}>
        {backdrop && (
          <ChakraDialog.Backdrop
            backdropFilter="var(--lw-backdrop-blur, blur(8px))"
            {...backdropProps}
            background="transparent"
          />
        )}
        <ChakraDialog.Positioner {...positionerProps}>
          <ChakraDialog.Content ref={ref} {...contentProps} />
        </ChakraDialog.Positioner>
      </Portal>
    );
  },
);

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
      <CloseButton ref={ref} size="sm">
        {props.children}
      </CloseButton>
    </ChakraDialog.CloseTrigger>
  );
});

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
  Title: DialogTitle,
  Description: DialogDescription,
  Trigger: DialogTrigger,
  ActionTrigger: DialogActionTrigger,
};
