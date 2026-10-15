"use client";

import {
  Box,
  Toaster as ChakraToaster,
  createToaster,
  type CreateToasterReturn,
  type ToastOptions,
  Portal,
  Spinner,
  Stack,
  Toast,
} from "@chakra-ui/react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { isToastControl, useToastStack, useToastSwipe } from "./toast-interactions.ts";

/** How many cards a collapsed stack shows: the newest and two peeking behind it. */
export const STACK_DEPTH = 3;

const instance: CreateToasterReturn = createToaster({
  placement: "bottom",
  pauseOnPageIdle: true,
  // Interaction is owned by the region below; Zag keeps the toast lifecycle and measurements.
  overlap: true,
  gap: 12,
});

type ToastCreateArgs = Omit<ToastOptions, "meta"> & {
  meta?: Record<string, unknown> & { closable?: never };
};

export const toaster: Omit<CreateToasterReturn, "create"> & {
  create(args: ToastCreateArgs): string;
} = {
  ...instance,
  create: (args: ToastCreateArgs) =>
    instance.create({
      duration: 5000,
      ...args,
      meta: { ...args.meta, placement: "bottom" },
    }),
};

/** Status glyphs remain distinct even when the status colour cannot be perceived. */
const STATUS = {
  error: { fg: "red.fg" },
  warning: { fg: "orange.fg" },
  success: { fg: "green.fg" },
  info: { fg: "blue.fg" },
  loading: { fg: "fg.muted" },
} as const;

type ToastStatus = keyof typeof STATUS;
const statusOf = (type: string | undefined): ToastStatus =>
  type && type in STATUS ? (type as ToastStatus) : "info";

/** The action is a small button on the title line in the toast's own foreground. */
export const toastActionStyle = {
  color: "inherit",
  opacity: 0.92,
  height: "5",
  paddingInline: "2.5",
  borderRadius: "md",
  borderWidth: "1px",
  borderColor: "var(--toast-border-color, var(--chakra-colors-border-muted))",
  bg: "var(--toast-trigger-bg)",
  fontSize: "12px",
  fontWeight: "560",
  lineHeight: "1",
  "&:hover": {
    opacity: 1,
    bg: "color-mix(in srgb, var(--toast-trigger-bg), currentColor 12%)",
  },
  "&:focus-visible": { outline: "2px solid currentColor", outlineOffset: "1px" },
} as const;

function StatusGlyph({ status }: { status: ToastStatus }) {
  const props = { size: 15, "aria-hidden": true } as const;
  if (status === "loading") return <Spinner size="xs" color="inherit" />;
  if (status === "success") return <CheckCircle2 {...props} />;
  if (status === "error") return <AlertCircle {...props} />;
  if (status === "warning") return <TriangleAlert {...props} />;
  return <Info {...props} />;
}

function StatusIcon({ status }: { status: ToastStatus }) {
  return (
    <Box color={STATUS[status].fg} display="flex" alignItems="center" height="5" flexShrink={0}>
      <StatusGlyph status={status} />
    </Box>
  );
}

export function Toaster({
  renderMeta,
}: {
  renderMeta?: (meta: Record<string, unknown> | undefined) => ReactNode;
}) {
  const stack = useToastStack(instance);

  return (
    <Portal>
      <div ref={stack.region}>
        <ChakraToaster
          toaster={toaster}
          insetInline={{ mdDown: "4" }}
          data-expanded={stack.expanded ? "" : void 0}
          data-hovered={stack.hovered ? "" : void 0}
          onMouseOverCapture={(event) => event.stopPropagation()}
          onMouseOutCapture={(event) => event.stopPropagation()}
          onMouseMoveCapture={(event) => event.stopPropagation()}
          onPointerEnter={(event) => {
            if (event.pointerType !== "touch") stack.setHovered(true);
          }}
          onPointerLeave={() => stack.setHovered(false)}
          onPointerDownCapture={() => {
            stack.pointerFocus.current = true;
          }}
          onPointerUpCapture={() => {
            stack.pointerFocus.current = false;
          }}
          onPointerCancelCapture={() => {
            stack.pointerFocus.current = false;
          }}
          onFocusCapture={(event) => {
            event.stopPropagation();
            stack.setFocused(true);
            // Pointer focus on a button must not open the stack before its action runs.
            if (!stack.pointerFocus.current) stack.setExpanded(true);
          }}
          onBlurCapture={(event) => {
            event.stopPropagation();
            if (!event.currentTarget.contains(event.relatedTarget)) stack.setFocused(false);
          }}
          onClick={(event) => {
            if (!isToastControl(event.target)) stack.setExpanded(true);
          }}
        >
          {(toast) => {
            if (!toast.id) return null;
            const status = statusOf(toast.type);
            return (
              <SwipeToast id={toast.id} status={status} onDragging={stack.setDragging}>
                <StatusIcon status={status} />
                <Stack gap="0.5" flex="1" minWidth={0} maxWidth="100%">
                  {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
                  {toast.description && (
                    <Toast.Description color="inherit" opacity={1}>
                      {toast.description}
                    </Toast.Description>
                  )}
                  {renderMeta?.(toast.meta)}
                </Stack>
                {toast.action && (
                  <Toast.ActionTrigger alignSelf="flex-start" flexShrink={0} css={toastActionStyle}>
                    {toast.action.label}
                  </Toast.ActionTrigger>
                )}
                <Toast.CloseTrigger
                  position="static"
                  alignSelf="flex-start"
                  boxSize="5"
                  padding={0}
                  flexShrink={0}
                />
              </SwipeToast>
            );
          }}
        </ChakraToaster>
      </div>
    </Portal>
  );
}

function SwipeToast({
  id,
  status,
  onDragging,
  children,
}: {
  id: string;
  status: ToastStatus;
  onDragging: (dragging: boolean) => void;
  children: ReactNode;
}) {
  const swipe = useToastSwipe({ dismiss: () => instance.dismiss(id), onDragging });
  return (
    <Toast.Root
      {...swipe}
      width={{ md: "sm" }}
      role={status === "error" ? "alert" : void 0}
      style={{ touchAction: "pan-y", userSelect: "none" }}
    >
      {children}
    </Toast.Root>
  );
}
