// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  GovernanceValidationError,
  OCSF_INGEST_MAX_FUTURE_MS,
  OCSF_PUSHED_SOURCE_TYPE,
  type OcsfIngestRequest,
  type OcsfIngestResponse,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";

import type { GovernanceOcsfEventSink } from "../../../repositories/governance.repositories.ts";
import { ocsfEventToGovernanceRow } from "../rules/ocsf-ingest-row.rules.ts";

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
    const rows = [...byUid.values()].map((event) =>
      ocsfEventToGovernanceRow({
        tenantId: tenant.id,
        sourceType: OCSF_PUSHED_SOURCE_TYPE,
        sourceId: input.source,
        event,
      }),
    );
    await this.deps.events.insertEvents(rows);
    return { accepted: rows.length };
  }
}
