import { SecretTrpcApi } from "@langwatch/secret-server";
import { appTrpcRoot } from "~/server/api/trpc.root";
import {
  auditLogMutations,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "~/server/api/trpc.runtime-policy";

const featureProcedure = appTrpcRoot.procedure
  .use(tracerMiddleware)
  .use(loggerMiddleware)
  .use(handledErrorMiddleware)
  .use(auditLogMutations);

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const secretsRouter = SecretTrpcApi.create(appTrpcRoot, {
  protected: featureProcedure,
});
