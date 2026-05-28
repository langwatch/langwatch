"use client";

import {
  Toaster as ChakraToaster,
  createToaster,
  Portal,
  Spinner,
  Stack,
  Toast,
} from "@chakra-ui/react";
import { Info } from "react-feather";
import { captureException } from "~/utils/posthogErrorCapture";

const toaster_ = createToaster({
  placement: "top-end",
  pauseOnPageIdle: true,
});

// Workaround for https://github.com/chakra-ui/chakra-ui/issues/9490#issuecomment-2601014577
export const toaster = {
  ...toaster_,
  // Opt-in error reporting: pass the caught `error` and it's forwarded to
  // PostHog as a $exception, so handled failures (not just uncaught crashes)
  // reach the error/quality metrics. Validation toasts pass no `error` and
  // stay silent — the presence of a real error is the signal, so we never
  // report plain "field required" messages.
  create: (
    args: Parameters<typeof toaster_.create>[0] & { error?: unknown },
  ) => {
    const { error, ...toastArgs } = args;
    if (error !== undefined) {
      captureException(error, { tags: { source: "toaster" } });
    }
    return toaster_.create({
      duration: 5000,
      ...toastArgs,
      meta: {
        ...toastArgs.meta,
        placement: "top-end",
      },
    });
  },
};

export const Toaster = () => {
  return (
    <Portal>
      <ChakraToaster toaster={toaster} insetInline={{ mdDown: "4" }}>
        {(toast) => (
          <Toast.Root width={{ md: "sm" }}>
            {toast.type === "loading" ? (
              <Spinner size="sm" color="blue.solid" />
            ) : toast.type === "info" ? (
              <Info size={18} style={{ marginTop: "2px" }} />
            ) : (
              <Toast.Indicator />
            )}
            <Stack gap="1" flex="1" maxWidth="100%">
              {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
              {toast.description && (
                <Toast.Description>{toast.description}</Toast.Description>
              )}
              {toast.action && (
                <Toast.ActionTrigger marginTop="2">
                  {toast.action.label}
                </Toast.ActionTrigger>
              )}
            </Stack>
            {toast.meta?.closable && <Toast.CloseTrigger />}
          </Toast.Root>
        )}
      </ChakraToaster>
    </Portal>
  );
};
