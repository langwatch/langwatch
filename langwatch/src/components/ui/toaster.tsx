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

// Explicitly typed: createToaster's inferred return references @zag-js
// internals that cannot be named in an emitted .d.ts.
const toaster_: ReturnType<typeof createToaster> = createToaster({
  placement: "top-end",
  pauseOnPageIdle: true,
});

// Workaround for https://github.com/chakra-ui/chakra-ui/issues/9490#issuecomment-2601014577
export const toaster: ReturnType<typeof createToaster> = {
  ...toaster_,
  create: (args: Parameters<typeof toaster_.create>[0]) => {
    return toaster_.create({
      duration: 5000,
      ...args,
      meta: {
        ...args.meta,
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
