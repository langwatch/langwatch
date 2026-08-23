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
import type { ReactNode } from "react";

const instance = createToaster({ placement: "bottom", pauseOnPageIdle: true });

type ToastCreateArgs = Omit<Parameters<typeof instance.create>[0], "meta"> & {
  meta?: Record<string, unknown> & { closable?: never };
};

export const toaster = {
  ...instance,
  create: (args: ToastCreateArgs) =>
    instance.create({
      duration: 5000,
      ...args,
      meta: { ...args.meta, placement: "bottom" },
    }),
};

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
const onPanelOnly = (status: ToastStatus, color: string) =>
  STATUS[status].filled ? { _light: "inherit", _dark: color } : color;

export const toastActionColor = (type: string | undefined) => {
  const status = statusOf(type);
  return onPanelOnly(status, STATUS[status].action);
};

function StatusIcon({ status }: { status: ToastStatus }) {
  const props = { size: 15, "aria-hidden": true } as const;
  return (
    <Box
      color={onPanelOnly(status, STATUS[status].fg)}
      display="flex"
      alignItems="center"
      height="5"
      flexShrink={0}
    >
      {status === "loading" ? (
        <Spinner size="xs" color="inherit" />
      ) : status === "success" ? (
        <CheckCircle2 {...props} />
      ) : status === "error" ? (
        <AlertCircle {...props} />
      ) : status === "warning" ? (
        <TriangleAlert {...props} />
      ) : (
        <Info {...props} />
      )}
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
                {toast.action && (
                  <Toast.ActionTrigger
                    marginTop="2"
                    alignSelf="flex-start"
                    fontSize="12px"
                    fontWeight="560"
                    css={{ color: toastActionColor(toast.type) }}
                  >
                    {toast.action.label}
                  </Toast.ActionTrigger>
                )}
              </Stack>
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
