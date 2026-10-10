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
import { type ReactNode, useEffect, useState } from "react";

/** How many cards a collapsed stack shows: the newest and two peeking behind it. */
export const STACK_DEPTH = 3;

const instance: CreateToasterReturn = createToaster({
  placement: "bottom",
  pauseOnPageIdle: true,
  // Sonner's stack: cards overlap until the pointer or focus enters, then fan
  // out, and every timer holds while they are fanned.
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

/** The icon carries the status hue: light on the tinted glass, a tint on the dark panel. */
const STATUS = {
  error: { fg: { _light: "red.300", _dark: "red.fg" } },
  warning: { fg: { _light: "orange.300", _dark: "orange.fg" } },
  success: { fg: { _light: "green.300", _dark: "green.fg" } },
  info: { fg: { _light: "blue.300", _dark: "fg.muted" } },
  loading: { fg: "fg.muted" },
} as const;

type ToastStatus = keyof typeof STATUS;
const statusOf = (type: string | undefined): ToastStatus =>
  type && type in STATUS ? (type as ToastStatus) : "info";

/** The action is a small pill on the title line in the toast's own foreground, in both modes. */
export const toastActionStyle = {
  color: "inherit",
  opacity: 0.92,
  height: "5",
  paddingInline: "2.5",
  borderRadius: "full",
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

/** A toast's lifetime drawn as a bar that drains, holding whenever its timer does. */
function LifetimeBar({ lifetime }: { lifetime: number }) {
  return (
    <Box
      data-toast-lifetime=""
      aria-hidden
      position="absolute"
      insetInline="3.5"
      bottom="1"
      height="2px"
      borderRadius="full"
      bg="currentColor"
      opacity={0.3}
      transformOrigin="left"
      pointerEvents="none"
      css={{
        "--toast-lifetime": `${lifetime}ms`,
        animationName: "toast-drain",
        animationDuration: "var(--toast-lifetime)",
        animationTimingFunction: "linear",
        animationFillMode: "forwards",
        "[data-paused] &": { animationPlayState: "paused" },
        _motionReduce: { display: "none" },
      }}
    />
  );
}

/** How many toasts wait behind the collapsed stack, on the peeking cards above the front one. */
function MoreChip({ count }: { count: number }) {
  return (
    <Box
      data-toast-more=""
      aria-hidden
      position="absolute"
      bottom="100%"
      marginBottom="1"
      insetInlineEnd="10"
      paddingX="2"
      borderRadius="full"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.panel"
      color="fg.muted"
      textStyle="xs"
      fontWeight="medium"
      boxShadow="sm"
      css={{ "[data-stack] &": { display: "none" } }}
    >
      +{count} more
    </Box>
  );
}

/** A persistent or loading toast has no lifetime to draw. */
const lifetimeOf = ({ type, duration }: { type?: string; duration?: number }) =>
  type !== "loading" && duration !== undefined && Number.isFinite(duration) ? duration : null;

export function Toaster({
  renderMeta,
}: {
  renderMeta?: (meta: Record<string, unknown> | undefined) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest("[data-toast-region]"))
        setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return (
    <Portal>
      <ChakraToaster
        data-toast-region=""
        toaster={toaster}
        insetInline={{ mdDown: "4" }}
        data-fan={open ? undefined : ""}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("button")) return;
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
      >
        {(toast) => {
          const status = statusOf(toast.type);
          const stack = toaster.getVisibleToasts();
          const hidden = stack.length - STACK_DEPTH;
          const lifetime = lifetimeOf({ type: toast.type, duration: toast.duration });
          return (
            <Toast.Root width={{ md: "sm" }} role={status === "error" ? "alert" : undefined}>
              {hidden > 0 && stack[0]?.id === toast.id && <MoreChip count={hidden} />}
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
              {lifetime !== null && <LifetimeBar lifetime={lifetime} />}
            </Toast.Root>
          );
        }}
      </ChakraToaster>
    </Portal>
  );
}
