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

/** How many cards a collapsed stack shows: the newest and two peeking behind it. */
export const STACK_DEPTH = 3;

const instance: CreateToasterReturn = createToaster({
  placement: "bottom",
  pauseOnPageIdle: true,
  // Cards overlap until the pointer or focus enters, then list; timers hold meanwhile.
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

/** The icon carries the status; the card itself stays the ordinary panel. */
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
  return (
    <Portal>
      <ChakraToaster toaster={toaster} insetInline={{ mdDown: "4" }}>
        {(toast) => {
          const status = statusOf(toast.type);
          return (
            <Toast.Root width={{ md: "sm" }} role={status === "error" ? "alert" : undefined}>
              <StatusIcon status={status} />
              <Stack gap="0.5" flex="1" maxWidth="100%">
                {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
                {toast.description && <Toast.Description>{toast.description}</Toast.Description>}
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
            </Toast.Root>
          );
        }}
      </ChakraToaster>
    </Portal>
  );
}
