import { createNextApiHandler } from "@trpc/server/adapters/next";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

// Logging is handled by the tRPC middleware in src/server/api/trpc.ts
// to avoid double logging and to include duration/status info
export default createNextApiHandler({
  router: appRouter,
  createContext: createTRPCContext,
});
