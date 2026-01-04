import { useEffect, useRef, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:use-sse-subscription");

interface SSESubscriptionOptions<TData, TError> {
  enabled?: boolean;
  onData?: (data: TData) => void;
  onError?: (error: TError) => void;
  onStarted?: () => void;
  onStopped?: () => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export type ConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export function useSSESubscription<TData = unknown, TInput = Record<string, unknown>>(
  subscription: {
    useSubscription: (
      input: TInput,
      opts: {
        enabled?: boolean;
        onData?: (data: TData) => void;
        onError?: (error: TRPCClientError<AppRouter>) => void;
        onStarted?: () => void;
        onStopped?: () => void;
      }
    ) => void;
  },
  input: TInput,
  options: SSESubscriptionOptions<TData, TRPCClientError<AppRouter>> = {}
) {
  const {
    enabled = true,
    onData,
    onError,
    onStarted,
    onStopped,
    onConnected,
    onDisconnected,
  } = options;

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    enabled ? "connecting" : "disconnected"
  );

  const lastDataRef = useRef<TData | undefined>(void 0);
  const lastErrorRef = useRef<TRPCClientError<AppRouter> | undefined>(void 0);
  const hasConnectedRef = useRef(false);

  logger.debug({ enabled, input }, "SSE subscription hook initialized");

  subscription.useSubscription(input, {
    enabled,

    onStarted: () => {
      hasConnectedRef.current = false;
      setConnectionState("connecting");
      logger.info({ input }, "SSE subscription started");
      onStarted?.();
    },

    onData: (data: TData) => {
      if (!hasConnectedRef.current) {
        hasConnectedRef.current = true;
        setConnectionState("connected");
        logger.info({ input }, "SSE subscription connected");
        onConnected?.();
      }

      lastDataRef.current = data;
      logger.debug({ input, data: typeof data }, "SSE data received");
      onData?.(data);
    },

    onError: (error: TRPCClientError<AppRouter>) => {
      hasConnectedRef.current = false;
      lastErrorRef.current = error;
      setConnectionState("error");
      logger.error({ input, error: error.message }, "SSE subscription error");
      onError?.(error);
    },

    onStopped: () => {
      hasConnectedRef.current = false;
      setConnectionState("disconnected");
      logger.info({ input }, "SSE subscription stopped");
      onStopped?.();
      onDisconnected?.();
    },
  });

  useEffect(() => {
    if (!enabled) {
      hasConnectedRef.current = false;
      setConnectionState("disconnected");
      logger.debug({ input }, "SSE subscription disabled");
    } else {
      setConnectionState((s) => (s === "disconnected" ? "connecting" : s));
      logger.debug({ input }, "SSE subscription enabled");
    }
  }, [enabled]);

  return {
    connectionState,
    retryCount: 0,
    lastData: lastDataRef.current,
    lastError: lastErrorRef.current,
    isConnected: connectionState === "connected",
    isConnecting: connectionState === "connecting",
    hasError: connectionState === "error",
    isDisconnected: connectionState === "disconnected",
  } as const;
}
