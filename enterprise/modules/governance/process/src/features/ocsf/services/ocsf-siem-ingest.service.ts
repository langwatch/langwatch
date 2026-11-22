// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  GovernanceValidationError,
  OCSF_INGEST_MAX_FUTURE_MS,
  OCSF_PUSHED_SOURCE_TYPE,
  type OcsfIngestRequest,
  type OcsfIngestResponse,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";

import type {
  GovernanceOcsfEvent,
  GovernanceOcsfEventSink,
} from "../../../repositories/governance.repositories.ts";

type OcsfSiemIngestDependencies = {
  events: GovernanceOcsfEventSink;
  /** The tenant-history wrapper, so an ingest that creates the governance tenant records it. */
  projects: Pick<ProjectApi, "ensureInternal">;
  now: () => number;
};

/** The push-in write path. Spec: enterprise/modules/governance/specs/ocsf-siem.feature */
export class OcsfSiemIngestService {
  private constructor(private readonly deps: OcsfSiemIngestDependencies) {}

  static create(deps: OcsfSiemIngestDependencies): OcsfSiemIngestService {
    return new OcsfSiemIngestService(deps);
  }

  /** OCSF events from another source, stored as sent; one row per (source, metadata.uid). */
  async ingest(input: OcsfIngestRequest & { organizationId: string }): Promise<OcsfIngestResponse> {
    const tenant = await this.deps.projects.ensureInternal({
      organizationId: input.organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    const latest = this.deps.now() + OCSF_INGEST_MAX_FUTURE_MS;
    const ahead = input.events.findIndex((event) => event.time > latest);
    if (ahead >= 0) {
      const complaint = `events.${ahead}.time is more than a day in the future`;
      throw new GovernanceValidationError(complaint, { formErrors: [complaint] });
    }
    const byUid = new Map(input.events.map((event) => [event.metadata.uid, event]));
    const rows = [...byUid.values()].map((event): GovernanceOcsfEvent => {
      const actor = (event.actor ?? {}) as { user?: { uid?: unknown; email_addr?: unknown } };
      const api = (event.api ?? {}) as { operation?: unknown };
      const target = (event.dst_endpoint ?? {}) as { name?: unknown; hostname?: unknown };
      const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 512) : "");
      const activityId = event.activity_id ?? 0;
      return {
        tenantId: tenant.id,
        eventId: `${OCSF_PUSHED_SOURCE_TYPE}:${input.source}:${event.metadata.uid}`,
        classUid: event.class_uid,
        categoryUid: event.category_uid ?? Math.floor(event.class_uid / 1000),
        typeUid: event.type_uid ?? event.class_uid * 100 + activityId,
        traceId: "",
        sourceId: input.source,
        sourceType: OCSF_PUSHED_SOURCE_TYPE,
        activityId,
        severityId: event.severity_id,
        eventTime: Temporal.Instant.fromEpochMilliseconds(event.time),
        actorUserId: text(actor.user?.uid),
        actorEmail: text(actor.user?.email_addr),
        actorEnduserId: "",
        actionName: text(api.operation) || text(event.class_name) || `class_${event.class_uid}`,
        targetName: text(target.name) || text(target.hostname),
        anomalyAlertId: "",
        rawOcsfJson: JSON.stringify(event),
      };
    });
    await this.deps.events.insertEvents(rows);
    return { accepted: rows.length };
  }
}
