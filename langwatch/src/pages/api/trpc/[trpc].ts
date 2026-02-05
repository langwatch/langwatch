import { createNextApiHandler } from "@trpc/server/adapters/next";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

// Logging and tracing are handled by tRPC middlewares in src/server/api/trpc.ts
export default createNextApiHandler({
  router: appRouter,
  createContext: createTRPCContext,
});
