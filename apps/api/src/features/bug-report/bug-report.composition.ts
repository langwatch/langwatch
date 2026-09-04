/**
 * The support inbox, composed as its own feature.
 *
 * `bugReports.*` — the reports `langwatch report` and the MCP tool file, read
 * by the back office. It used to be composed inside the product half beside a
 * reviewer's annotations and the project's privacy rules; the three shared this
 * process's connection and nothing else, so a deployment missing any one of the
 * half's six collaborators lost the inbox with them.
 *
 * The reports are a GLOBAL table with no tenant column, which is why the read
 * is gated by the staff declaration the package writes rather than by a scope:
 * there is no scope to check. Every read is written to the audit trail before
 * the reader sees the row — it is the record of who opened somebody's
 * transcript.
 */
import { HandledError } from "@langwatch/handled-error";
import {
  BugReportInboxService,
  PrismaBugReportRepository,
  type BugReportListing,
  type BugReportTrpcPorts,
} from "@langwatch/ops-server";
import type { BugReport } from "@langwatch/prisma-client/generated";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { createBugReportTrpcRouter } from "./bug-report-trpc.mount";

/** The one namespace, built over the composed inbox. */
export type ComposedBugReportFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createBugReportTrpcRouter>;
}>;

/** The inbox's ports: the two reads, and the trail each is written to. */
type ApiBugReportPorts = BugReportTrpcPorts<BugReportListing, BugReport>;

/** Composes the support inbox over this process's own graph. */
export function composeBugReportFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
}): ComposedBugReportFeature {
  const reports = BugReportInboxService.create({
    reports: PrismaBugReportRepository.create({ prisma: options.infrastructure.prisma }),
  });
  const audit = options.infrastructure.audit;

  const ports: ApiBugReportPorts = {
    getAll: (input) => reports.getAll(input),
    getById: (input) => reports.getById(input),
    /**
     * Unlike the API-key sink this one is AWAITED: the row is the record of who
     * opened somebody's transcript, and it is written before they see it.
     */
    recordAudit: async (entry) => {
      await audit?.record({
        actorId: entry.userId,
        path: entry.action,
        input: {
          ...entry.args,
          targetKind: entry.targetKind,
          ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
        },
        error: null,
      });
    },
  };

  return { router: (mount) => createBugReportTrpcRouter({ ...mount, ports }) };
}

/**
 * The support inbox on a process that composed no database.
 *
 * The namespace still mounts and both reads refuse by name, so the back office
 * says the deployment cannot answer rather than rendering an empty inbox that
 * reads as "nobody has reported anything".
 */
export function refusingBugReportFeature(): ComposedBugReportFeature {
  const refuse = (): never => {
    throw new ApiBugReportUnavailableError("The support inbox");
  };
  const ports = new Proxy({}, { get: () => refuse, has: () => true }) as ApiBugReportPorts;

  return { router: (mount) => createBugReportTrpcRouter({ ...mount, ports }) };
}

/** A capability this deployment did not compose, refused by name. */
class ApiBugReportUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiBugReportUnavailableError";
  }
}
