import {
  createWSClient,
  httpBatchLink,
  httpLink,
  loggerLink,
  splitLink,
  wsLink,
} from "@trpc/client";
import superjson from "superjson";

import { sseLink } from "./sseLink";

const getBaseUrl = () => {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.BASE_HOST) return `https://${process.env.BASE_HOST}`;
  return `http://localhost:${process.env.PORT ?? 5560}`;
};

let cachedWSClient: ReturnType<typeof createWSClient> | null = null;

function getOrCreateWSClient(): ReturnType<typeof createWSClient> | null {
  if (typeof window === "undefined") return null;
  if (cachedWSClient) return cachedWSClient;

  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  cachedWSClient = createWSClient({
    url: `${proto}//${window.location.host}/api/trpc-ws`,
  });

  return cachedWSClient;
}

export function createTRPCLinks() {
  const wsClient = getOrCreateWSClient();
  const httpRouting = splitLink({
    condition(op) {
      return op.context.skipBatch === true;
    },
    true: httpLink({
      url: `${getBaseUrl()}/api/trpc`,
      transformer: superjson,
    }),
    false: httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
      maxURLLength: 4000,
      transformer: superjson,
    }),
  });
  const httpOrWsRouting = wsClient
    ? splitLink({
        condition(op) {
          return op.context.useWS === true;
        },
        true: wsLink({ client: wsClient, transformer: superjson }),
        false: httpRouting,
      })
    : httpRouting;

  return [
    loggerLink({
      enabled: (opts) =>
        process.env.NODE_ENV === "development" ||
        (opts.direction === "down" && opts.result instanceof Error),
    }),
    splitLink({
      condition(op) {
        return op.type === "subscription";
      },
      true: sseLink({
        url: getBaseUrl(),
        transformPath: (path) => `/api/sse/${path}`,
        maxReconnectAttempts: 5,
        reconnectDelay: 1000,
      }),
      false: httpOrWsRouting,
    }),
  ];
}
