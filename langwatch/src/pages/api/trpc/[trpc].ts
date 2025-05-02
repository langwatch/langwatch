import { createNextApiHandler } from "@trpc/server/adapters/next";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:trpc");

// export API handler
export default createNextApiHandler({
  router: appRouter,
  createContext: createTRPCContext,
  onError: (({ ctx, error, input, path, type }) => {
    const logData: Record<string, any> = {
      error,
      path,
      type,
      userId: (ctx?.session?.user?.id) || null,
      projectId: (input as any)?.projectId,
      organizationId: (input as any)?.organizationId,
    };

    return logger.error(logData, "trpc error");
  }),
});
