/**
 * The server half of `bugReports.*`: the support inbox the back office reads.
 *
 * The staff gate and the audit row are both the application's. Every read is
 * audit-logged before it is answered, because a report carries a
 * reporter-submitted transcript and a contact address, so who opened the inbox
 * is itself a fact worth keeping.
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
