/**
 * The server half of `bugReports.*`: the support inbox the back office
 * reads. Staff gate and audit row are both the application's - every read
 * is logged before it is answered, since who opened it is worth keeping.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { OpsApi, opsBugReportTrpc } from "@langwatch/ops-contract";

import { BUG_REPORTS_STAFF_ONLY, opsOperatorFact } from "#transport/ops-operator.trpc";

export const opsBugReportTrpcTransport = defineTrpcRouter(OpsApi, opsBugReportTrpc)
  .procedure("getAll")
  .withFacts(opsOperatorFact)
  .noPermission(BUG_REPORTS_STAFF_ONLY)
  .handle(({ app, input }, operator) => {
    const staff = app.admitStaff(operator);

    return app.listBugReports({ ...input, actorUserId: staff.id });
  })

  .procedure("getById")
  .withFacts(opsOperatorFact)
  .noPermission(BUG_REPORTS_STAFF_ONLY)
  .handle(({ app, input }, operator) => {
    const staff = app.admitStaff(operator);

    return app.getBugReport({ id: input.id, actorUserId: staff.id });
  })
  .build();
