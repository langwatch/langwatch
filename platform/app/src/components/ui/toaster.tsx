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
 * The status colour, spent on the small icon and on the action.
 *
 * The action carries the accent, and on a toast that already reads as good news
 * the warm accent reads as a warning about it. So a success toast's action wears
 * the same green its icon does, and every other status keeps the accent.
 */
const STATUS = {
  error: { fg: "red.fg", action: "orange.fg" },
  warning: { fg: "yellow.fg", action: "orange.fg" },
  success: { fg: "green.fg", action: "green.fg" },
  info: { fg: "fg.muted", action: "orange.fg" },
  loading: { fg: "fg.muted", action: "orange.fg" },
} as const;

type ToastStatus = keyof typeof STATUS;

const statusOf = (type: string | undefined): ToastStatus =>
  type && type in STATUS ? (type as ToastStatus) : "info";

/**
 * The colour a toast's action reads in. Exported because it is the whole of the
 * rule: on a toast that already says something went right, the warm accent
 * reads as a warning about it, so success spends its own green there.
 */
export const toastActionColor = (type: string | undefined): string =>
  STATUS[statusOf(type)].action;

function StatusIcon({ status }: { status: ToastStatus }) {
  const { fg } = STATUS[status];
  const size = 15;

  return (
    <Box color={fg} display="flex" flexShrink={0} marginTop="1px">
      {status === "loading" ? (
        <Spinner size="xs" color="fg.muted" />
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
 * Toasts are surface cards, not coloured slabs.
 *
 * The old shell used Chakra's filled variants: a saturated red rectangle with
 * white text for every failure. That shouts, and it makes the message harder
 * to read than the colour it is painted on. This follows the language Langy
 * already established (`features/asaplangy/tokens.ts`,
 * `features/langy/components/LangyError.tsx`): the panel material, ONE
 * hairline carrying the status tone, the status colour spent on a small icon,
 * and the accent reserved for the action. An error still reads in the
 * interface's voice — it says what happened and offers the way forward.
 *
 * The material itself — surface, radius, padding, type and the per-status
 * hairline — is the `toast` slot recipe in `pages/_app.tsx`.
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
                    color={toastActionColor(toast.type)}
                  >
                    {toast.action.label}
                  </Toast.ActionTrigger>
                )}
              </Stack>

              <Toast.CloseTrigger
                position="static"
                flexShrink={0}
                color="fg.subtle"
                _hover={{ color: "fg" }}
              />
            </Toast.Root>
          );
        }}
      </ChakraToaster>
    </Portal>
  );
};
