import {
  chakra,
  Dialog as ChakraDialog,
  HStack,
  IconButton,
  mergeRefs,
  Portal,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import * as React from "react";

import { BOUNDED_BODY, OverlayBodyState } from "../../overlays/overlay-body.tsx";
import { OverlayPortalTargetProvider } from "../../overlays/portal-target.ts";
import { FieldLayoutProvider } from "../forms/field-layout.ts";
import { StudioIsolatedErrorBoundary } from "../states/studio-error-boundary.tsx";
import { ActionRow, type FrameAction } from "./action-row.tsx";
import { CloseButton } from "./close-button.tsx";

export type { ActionRowProps, FrameAction } from "./action-row.tsx";
export { useOverlayPortalTarget } from "../../overlays/portal-target.ts";

export type DialogRootProps = Omit<ChakraDialog.RootProps, "size"> & {
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "5xl" | "6xl" | "cover" | "full";
};

/** @deprecated Render `<Dialog>` (the shape); the parts go in W-final. */
export function DialogRoot(props: DialogRootProps) {
  return <ChakraDialog.Root {...(props as ChakraDialog.RootProps)} />;
}

export interface DialogContentProps extends ChakraDialog.ContentProps {
  portalled?: boolean;
  portalRef?: React.RefObject<HTMLElement>;
  backdrop?: boolean;
  backdropProps?: Omit<ChakraDialog.BackdropProps, "bg" | "background" | "backgroundColor">;
  positionerProps?: ChakraDialog.PositionerProps;
  /** `false` drops the inline error boundary: a render crash then closes the dialog. */
  withErrorBoundary?: boolean;
  /** The label the error fallback shows when the crash carries no code. */
  errorScope?: string;
}

/** @deprecated Render `<Dialog>` (the shape). */
export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  function DialogContent(
    {
      portalled = true,
      portalRef,
      backdrop = true,
      backdropProps,
      positionerProps,
      withErrorBoundary = true,
      errorScope,
      children,
      ...contentProps
    },
    ref,
  ) {
    const portalTarget = React.useRef<HTMLDivElement>(null);
    const guarded = withErrorBoundary && !contentProps.asChild;
    return (
      <Portal disabled={!portalled} container={portalRef}>
        {backdrop && (
          <ChakraDialog.Backdrop
            backdropFilter="var(--lw-backdrop-blur, blur(8px))"
            {...backdropProps}
            background="transparent"
            data-lw-transparent-backdrop="true"
          />
        )}
        <FieldLayoutProvider value="stacked">
          <ChakraDialog.Positioner {...positionerProps}>
            <ChakraDialog.Content ref={ref} {...contentProps}>
              <OverlayPortalTargetProvider value={portalTarget}>
                {guarded ? (
                  <StudioIsolatedErrorBoundary scope={errorScope}>
                    {children}
                  </StudioIsolatedErrorBoundary>
                ) : (
                  children
                )}
              </OverlayPortalTargetProvider>
              {!contentProps.asChild && <div ref={portalTarget} data-overlay-portal-target="" />}
            </ChakraDialog.Content>
          </ChakraDialog.Positioner>
        </FieldLayoutProvider>
      </Portal>
    );
  },
);

/** @deprecated The shape draws its own X. */
export const DialogCloseTrigger = React.forwardRef<
  HTMLButtonElement,
  ChakraDialog.CloseTriggerProps
>(function DialogCloseTrigger(props, ref) {
  return (
    <ChakraDialog.CloseTrigger position="absolute" top="2" insetEnd="2" {...props} asChild>
      <CloseButton ref={ref} size="sm">
        {props.children}
      </CloseButton>
    </ChakraDialog.CloseTrigger>
  );
});

/** @deprecated Use the shape's actions. */
export const DialogFooter = ChakraDialog.Footer;
/** @deprecated Use the shape's `title`, `icon`, `onBack`. */
export const DialogHeader = ChakraDialog.Header;
/** @deprecated The shape's children are its body. */
export const DialogBody = ChakraDialog.Body;
/** @deprecated Use the shape's `title`. */
export const DialogTitle = ChakraDialog.Title;
/** @deprecated Use the shape's `description`. */
export const DialogDescription = ChakraDialog.Description;
/** @deprecated Open a dialog from state: `open` and `onClose`. */
export const DialogTrigger = ChakraDialog.Trigger;
/** @deprecated The shape draws Cancel. */
export const DialogActionTrigger = ChakraDialog.ActionTrigger;

/** The shared overlay width scale, as maxima capped by the viewport. */
export type DialogSize = "sm" | "md" | "lg" | "xl";

const DIALOG_WIDTH: Record<DialogSize, string> = {
  sm: "28rem",
  md: "32rem",
  lg: "42rem",
  xl: "56rem",
};

export interface DialogProps {
  open: boolean;
  /** A request to close (X, Escape, outside, Cancel): the dialog stays until `open` is false. */
  onClose: () => void;
  /** Sentence case; names the thing and the act. Always the accessible name. */
  title: string;
  /** Under the title, fg.muted; it describes the dialog (`aria-describedby`). */
  description?: React.ReactNode;
  /** 18px, before the title. */
  icon?: React.ReactNode;
  /** Default "sm"; the body scrolls inside the frame. */
  size?: DialogSize;
  /** Step two of a two-step dialog. */
  onBack?: () => void;
  /** The dialog owns the form: a `type: "submit"` action submits it. Never wrap a child form. */
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  /** The id of the dialog-owned form, so a control elsewhere can name it. */
  formId?: string;
  children?: React.ReactNode;
  /** `danger` for a destroying act. */
  primaryAction?: FrameAction;
  /** Takes Cancel's place: "Keep links paused", "Later", "Stay here". */
  secondaryAction?: FrameAction;
  /** Default "Cancel"; "Close" for a read-only dialog. */
  cancelLabel?: string;
  /** Footer left: the acknowledge checkbox, "Step 2 of 2". */
  note?: React.ReactNode;
  /** `false`: no X, no Cancel, no Escape, no outside click; only the actions close it. */
  dismissible?: boolean;
  /** "alertdialog" for a must-acknowledge or destroying confirm. Default "dialog". */
  role?: "dialog" | "alertdialog";
  /** Shorthand for `initialFocusEl`; falls back to the first field, then Cancel. */
  initialFocus?: "primary" | "cancel" | "secondary";
  initialFocusEl?: () => HTMLElement | null;
  finalFocusEl?: () => HTMLElement | null;
  onExitComplete?: () => void;
  /** `content`: a bounded flex column whose children own scrolling (editors). */
  bodyScroll?: "frame" | "content";
  loading?: boolean;
  error?: { title: string; description?: string; onRetry?: () => void };
  /** A save in flight: the X, Cancel, Escape, outside click and every action wait. */
  busy?: boolean;
  errorScope?: string;
  contentRef?: React.Ref<HTMLDivElement>;
  /** Prefixes the slot ids: `<id>-close`, `<id>-back`, `<id>-body`. */
  "data-testid"?: string;
}

/** The dialog shape: props in, one look out. The part statics are deprecated. */
export function DialogShape({
  open,
  onClose,
  title,
  description,
  icon,
  size = "sm",
  onBack,
  onSubmit,
  formId,
  children,
  primaryAction,
  secondaryAction,
  cancelLabel = "Cancel",
  note,
  dismissible = true,
  role = "dialog",
  initialFocus,
  initialFocusEl,
  finalFocusEl,
  onExitComplete,
  bodyScroll = "frame",
  loading = false,
  error,
  busy = false,
  errorScope,
  contentRef,
  "data-testid": testId,
}: DialogProps) {
  const ownRef = React.useRef<HTMLDivElement>(null);
  const slot = (name: string) => (testId ? `${testId}-${name}` : undefined);
  const closable = dismissible && !busy;
  const cancel =
    dismissible && !secondaryAction ? { label: cancelLabel, onClick: onClose } : undefined;
  const hasFooter = primaryAction ?? secondaryAction ?? cancel ?? note;
  const pickInitialFocus = () => {
    const enabled = (selector: string) =>
      ownRef.current?.querySelector<HTMLElement>(`${selector}:not([disabled])`) ?? null;
    const requested = initialFocus ? enabled(`[data-frame-action="${initialFocus}"]`) : null;
    return (
      requested ?? enabled("input, textarea, select") ?? enabled('[data-frame-action="cancel"]')
    );
  };
  const frame = (
    <>
      <ChakraDialog.Header>
        <HStack gap={2} align="center" minWidth={0}>
          {onBack && (
            <IconButton
              type="button"
              aria-label="Back"
              variant="ghost"
              size="xs"
              onClick={onBack}
              disabled={busy}
              marginStart={-1}
              data-testid={slot("back")}
            >
              <ArrowLeft aria-hidden />
            </IconButton>
          )}
          {icon != null && (
            <chakra.span display="inline-flex" color="fg.muted" aria-hidden>
              {icon}
            </chakra.span>
          )}
          <ChakraDialog.Title>{title}</ChakraDialog.Title>
        </HStack>
        {description != null && (
          <ChakraDialog.Description textStyle="sm" color="fg.muted">
            {description}
          </ChakraDialog.Description>
        )}
      </ChakraDialog.Header>
      <ChakraDialog.Body
        {...(bodyScroll === "content" ? BOUNDED_BODY : { overflowY: "auto" as const })}
        data-testid={slot("body")}
      >
        <OverlayBodyState loading={loading} error={error}>
          {children}
        </OverlayBodyState>
      </ChakraDialog.Body>
      {hasFooter != null && (
        <ChakraDialog.Footer>
          <ActionRow
            primaryAction={primaryAction}
            secondaryAction={secondaryAction}
            cancel={cancel}
            note={note}
            busy={busy}
          />
        </ChakraDialog.Footer>
      )}
    </>
  );
  return (
    <ChakraDialog.Root
      open={open}
      role={role}
      closeOnEscape={closable}
      closeOnInteractOutside={closable}
      initialFocusEl={initialFocusEl ?? pickInitialFocus}
      finalFocusEl={finalFocusEl}
      onExitComplete={onExitComplete}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
    >
      <DialogContent
        ref={mergeRefs(ownRef, contentRef)}
        maxWidth={`min(${DIALOG_WIDTH[size]}, calc(100vw - 2rem))`}
        width="full"
        maxHeight="calc(100dvh - 4rem)"
        withErrorBoundary={false}
        aria-label={title}
        data-size={size}
        data-testid={testId}
      >
        {dismissible && <DialogCloseTrigger disabled={busy} data-testid={slot("close")} />}
        <StudioIsolatedErrorBoundary scope={errorScope ?? title} resetKeys={[title]}>
          {onSubmit ? (
            <chakra.form
              id={formId}
              display="contents"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit(event);
              }}
            >
              {frame}
            </chakra.form>
          ) : (
            frame
          )}
        </StudioIsolatedErrorBoundary>
      </DialogContent>
    </ChakraDialog.Root>
  );
}

/**
 * `<Dialog open onClose title primaryAction>`. The part statics (`Dialog.Root`, ...) are
 * deprecated and go in W-final; outside the package, render the shape.
 */
export const Dialog = Object.assign(DialogShape, {
  /** @deprecated Render `<Dialog>` (the shape); the parts go in W-final. */
  Root: DialogRoot,
  /** @deprecated Render `<Dialog>` (the shape). */
  Content: DialogContent,
  /** @deprecated The shape draws its own X. */
  CloseTrigger: DialogCloseTrigger,
  /** @deprecated Use the shape's actions. */
  Footer: DialogFooter,
  /** @deprecated Use the shape's `title`, `icon`, `onBack`. */
  Header: DialogHeader,
  /** @deprecated The shape's children are its body. */
  Body: DialogBody,
  /** @deprecated Use the shape's `title`. */
  Title: DialogTitle,
  /** @deprecated Use the shape's `description`. */
  Description: DialogDescription,
  /** @deprecated Open a dialog from state. */
  Trigger: DialogTrigger,
  /** @deprecated The shape draws Cancel. */
  ActionTrigger: DialogActionTrigger,
});

export { Dialog as RawDialog } from "@chakra-ui/react";
