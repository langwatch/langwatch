/**
 * Every `bugReports.*` procedure: `getAll` pages the reports filed against the
 * product itself and `getById` opens one. The gate is not an RBAC permission -
 * a report carries no tenant, so there is no scope an id could be checked at.
 * What decides it is the LangWatch staff list.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  bugReportIdInputSchema,
  bugReportListingSchema,
  bugReportSchema,
  listBugReportsInputSchema,
} from "./ops-bug-report.ts";

export const opsBugReportTrpc = defineTrpcContract("bugReports")
  .query("getAll")
  .withInput(listBugReportsInputSchema)
  .withOutput(bugReportListingSchema)

  .query("getById")
  .withInput(bugReportIdInputSchema)
  .withOutput(bugReportSchema)
  .build();
