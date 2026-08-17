"use client";

import {
  Box,
  Toaster as ChakraToaster,
  createToaster,
  Portal,
  Spinner,
  Stack,
  Toast,
} from "@chakra-ui/react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";

import { ErrorActions } from "~/features/errors/components/ErrorActions";

const toaster_ = createToaster({
  placement: "bottom",
  pauseOnPageIdle: true,
});

/**
 * `closable` is not an option: the Toaster renders the close button on every
 * toast unconditionally, so no call site can create a toast the user cannot
 * dismiss.
 */
type ToastCreateArgs = Omit<Parameters<typeof toaster_.create>[0], "meta"> & {
  meta?: Record<string, unknown> & { closable?: never };
};

// Workaround for https://github.com/chakra-ui/chakra-ui/issues/9490#issuecomment-2601014577
export const toaster = {
  ...toaster_,
  create: (args: ToastCreateArgs) => {
    return toaster_.create({
      duration: 5000,
      ...args,
      meta: {
        ...args.meta,
        placement: "bottom",
      },
    });
  },
};

/**
 * The status colour, spent on the small icon and on the action, and whether
 * the status arrives on a solid fill.
 *
 * The action carries the accent, and on a toast that already reads as good news
 * the warm accent reads as a warning about it. So a success toast's action wears
 * the same green its icon does, and every other status keeps the accent.
 */
const STATUS = {
  error: { fg: "red.fg", action: "orange.fg", filled: true },
  warning: { fg: "yellow.fg", action: "orange.fg", filled: true },
  success: { fg: "green.fg", action: "green.fg", filled: true },
  info: { fg: "fg.muted", action: "orange.fg", filled: false },
  loading: { fg: "fg.muted", action: "orange.fg", filled: false },
} as const;

type ToastStatus = keyof typeof STATUS;

const statusOf = (type: string | undefined): ToastStatus =>
  type && type in STATUS ? (type as ToastStatus) : "info";

/**
 * The height of the title's line, which the icon and the close button both
 * centre on. It keeps the three on one axis, and a one-line toast as tall as
 * one line.
 */
const TITLE_LINE = "5";

/**
 * A colour to use on the panel, dropped where the toast arrives on a solid
 * fill: there the fill sets a contrast colour and everything on it inherits
 * that, since an accent has nothing to sit on. Only the three status toasts
 * are filled, and only in light mode — info and loading are a card throughout,
 * so they keep their colours as they are.
 */
const onPanelOnly = (status: ToastStatus, color: string) =>
  STATUS[status].filled ? { _light: "inherit", _dark: color } : color;

/**
 * The colour a toast's action reads in. Exported because it is the whole of the
 * rule: on a toast that already says something went right, the warm accent
 * reads as a warning about it, so success spends its own green there.
 */
export const toastActionColor = (type: string | undefined) => {
  const status = statusOf(type);
  return onPanelOnly(status, STATUS[status].action);
};

function StatusIcon({ status }: { status: ToastStatus }) {
  const { fg } = STATUS[status];
  const size = 15;

  return (
    <Box
      color={onPanelOnly(status, fg)}
      display="flex"
      alignItems="center"
      height={TITLE_LINE}
      flexShrink={0}
    >
      {status === "loading" ? (
        <Spinner size="xs" color="inherit" />
      ) : status === "success" ? (
        <CheckCircle2 size={size} aria-hidden="true" />
      ) : status === "error" ? (
        <AlertCircle size={size} aria-hidden="true" />
      ) : status === "warning" ? (
        <TriangleAlert size={size} aria-hidden="true" />
      ) : (
        <Info size={size} aria-hidden="true" />
      )}
    </Box>
  );
}

/**
 * Every toast carries a close button, a status icon, and whatever the caller
 * gave it: title, description, the docs link and error id of a handled error,
 * and one action.
 *
 * Light mode wears Chakra's filled toast, dark mode a panel with one hairline
 * in the status tone. That split, and the material itself — surface, radius,
 * padding and type — is the `toast` slot recipe in `pages/_app.tsx`; what
 * changes with it here is the colour of the icon and of the action, which have
 * a fill to sit on in one mode and not the other.
 */
export const Toaster = () => {
  return (
    <Portal>
      <ChakraToaster toaster={toaster} insetInline={{ mdDown: "4" }}>
        {(toast) => {
          const status = statusOf(toast.type);

          return (
            <Toast.Root
              width={{ md: "sm" }}
              // zag hard-codes `role="status"` on every toast, which is a
              // polite live region: a screen reader finishes whatever it is
              // saying first, and an error can auto-dismiss before it is ever
              // announced. A failure is assertive by definition — and the copy
              // IS the payload here, so losing it loses the whole toast. The
              // prop spreads onto the element and wins over zag's default.
              role={status === "error" ? "alert" : undefined}
            >
              <StatusIcon status={status} />

              <Stack gap="0.5" flex="1" maxWidth="100%">
                {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
                {toast.description && (
                  <Toast.Description>{toast.description}</Toast.Description>
                )}
                {/* Set by `showErrorToast` — the docs link and copyable error id
                    that every handled error offers. Plain `toaster.create` calls
                    leave these unset and render nothing here. */}
                <ErrorActions
                  color={onPanelOnly(status, "fg.subtle")}
                  accentColor={onPanelOnly(status, "orange.fg")}
                  docsUrl={
                    typeof toast.meta?.docsUrl === "string"
                      ? toast.meta.docsUrl
                      : undefined
                  }
                  traceId={
                    typeof toast.meta?.traceId === "string"
                      ? toast.meta.traceId
                      : undefined
                  }
                />
                {toast.action && (
                  <Toast.ActionTrigger
                    marginTop="2"
                    alignSelf="flex-start"
                    fontSize="12px"
                    fontWeight="560"
                    // Through `css`, not the `color` prop: the trigger renders a
                    // button, whose own `color` attribute types this as a plain
                    // string and rejects a per-mode value.
                    css={{ color: toastActionColor(toast.type) }}
                  >
                    {toast.action.label}
                  </Toast.ActionTrigger>
                )}
              </Stack>

              {/* In the row rather than absolutely placed, which is what lets
                  it keep the same inset as the status icon opposite it. Sized
                  to the title's line so it cannot make the toast taller than
                  its text, and top-aligned so it stays beside the title on a
                  toast that runs to several lines. Chakra's own
                  `currentColor/60` carries it on the fill and on the panel
                  alike. */}
              <Toast.CloseTrigger
                position="static"
                alignSelf="flex-start"
                boxSize={TITLE_LINE}
                padding={0}
                flexShrink={0}
                _hover={{ color: "currentColor" }}
              />
            </Toast.Root>
          );
        }}
      </ChakraToaster>
    </Portal>
  );
};
