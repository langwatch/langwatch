/**
 * The server half of `bugReports.*`: the support inbox the back office reads. The door asks
 * `ops:view` of the operator's platform grant; the audit row is the application's - every read
 * is logged against the acting operator before it is answered.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { OpsApi, opsBugReportTrpc } from "@langwatch/ops-contract";

export const opsBugReportTrpcTransport: TrpcRouterDeclaration<OpsApi, typeof opsBugReportTrpc> =
  defineTrpcRouter(OpsApi, opsBugReportTrpc)
    .procedure("getAll")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input, actor }) =>
      app.listBugReports({ ...input, actorUserId: actor.impersonatorId ?? actor.id }),
    )

    .procedure("getById")
    .withPermission("ops:view", { at: "platform" })
    .handle(({ app, input, actor }) =>
      app.getBugReport({ id: input.id, actorUserId: actor.impersonatorId ?? actor.id }),
    )
    .build();
