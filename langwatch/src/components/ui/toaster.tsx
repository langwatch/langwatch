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
  placement: "top-end",
  pauseOnPageIdle: true,
});

// Workaround for https://github.com/chakra-ui/chakra-ui/issues/9490#issuecomment-2601014577
export const toaster = {
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

/**
 * A restrained hairline in the status colour, mixed into the neutral border
 * rather than drawn on top of it — the same formula as the Langy card's
 * `accentBorder` (`features/asaplangy/tokens.ts`), which exists so a card can
 * carry a tone without wearing a coloured ring.
 */
const statusHairline = (color: string) =>
  `color-mix(in srgb, var(--chakra-colors-${color}) 26%, var(--chakra-colors-border-muted))`;

const STATUS = {
  error: { hairline: statusHairline("red-solid"), fg: "red.fg" },
  warning: { hairline: statusHairline("yellow-solid"), fg: "#c98a2f" },
  success: { hairline: statusHairline("green-solid"), fg: "green.fg" },
  info: { hairline: "border.muted", fg: "fg.muted" },
  loading: { hairline: "border.muted", fg: "fg.muted" },
} as const;

type ToastStatus = keyof typeof STATUS;

const statusOf = (type: string | undefined): ToastStatus =>
  type && type in STATUS ? (type as ToastStatus) : "info";

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
              // Material, radius, padding and type come from the `toast`
              // slot recipe in `pages/_app.tsx` — Chakra's defaults are
              // attribute selectors that a style prop can't outrank. Only the
              // per-status hairline is set here.
              borderColor={STATUS[status].hairline}
            >
              <StatusIcon status={status} />

              <Stack gap="0.5" flex="1" maxWidth="100%">
                {toast.title && (
                  <Toast.Title
                    fontSize="13.5px"
                    fontWeight="640"
                    lineHeight="1.35"
                    letterSpacing="-0.005em"
                  >
                    {toast.title}
                  </Toast.Title>
                )}
                {toast.description && (
                  <Toast.Description
                    fontSize="13px"
                    lineHeight="1.5"
                    color="fg.muted"
                  >
                    {toast.description}
                  </Toast.Description>
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
                    color="orange.fg"
                  >
                    {toast.action.label}
                  </Toast.ActionTrigger>
                )}
              </Stack>

              {toast.meta?.closable && (
                <Toast.CloseTrigger
                  position="static"
                  flexShrink={0}
                  color="fg.subtle"
                  _hover={{ color: "fg" }}
                />
              )}
            </Toast.Root>
          );
        }}
      </ChakraToaster>
    </Portal>
  );
};
