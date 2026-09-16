/**
 * Every `bugReports.*` procedure: `getAll` pages reports filed against the
 * product, `getById` opens one. Not an RBAC permission - a report carries
 * no tenant, so the LangWatch staff list decides instead.
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
