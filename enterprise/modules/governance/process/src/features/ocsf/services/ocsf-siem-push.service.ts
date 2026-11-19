// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  OCSF_EVENT_TYPE,
  OCSF_PUSHED_SOURCE_TYPE,
} from "@langwatch/enterprise-governance-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { eventMatches, type WebhookApi } from "@langwatch/webhook-contract";

import {
  governanceOcsfExportRowOf,
  type GovernanceOcsfEvent,
  type GovernanceOcsfEventSink,
} from "../../../repositories/governance.repositories.ts";
import type { OcsfPushIntent } from "../eventing/ocsf-push-delivery.process.ts";
import { governanceRowToOcsfEvent } from "../rules/ocsf-v1-9-event.rules.ts";

/** Where the push records its webhook fan-out: governance's outbox, drained by the worker. */
export interface OcsfPushOutbox {
  record(intents: readonly OcsfPushIntent[]): Promise<void>;
}

type OcsfSiemPushDependencies = {
  events: GovernanceOcsfEventSink;
  projects: Pick<ProjectApi, "getOrganizationId">;
  webhooks: Pick<WebhookApi, "getAll">;
  entitlements: { hasEnterprisePlan: (organizationId: string) => Promise<boolean> };
  /** The pipeline's outbox in the worker, the Postgres intents in the api; memory-only stacks push nothing. */
  outbox: () => OcsfPushOutbox | undefined;
};

/**
 * The writer every LangWatch-built OCSF row goes through: it writes the rows, then queues each event
 * for every subscribed endpoint of the organisation, keyed by event id, so a row written again is
 * sent once. A failed queue throws, so the caller re-drives the write, which replaces by key. Spec: enterprise/modules/governance/specs/ocsf-siem.feature
 */
export class OcsfSiemPushService implements GovernanceOcsfEventSink {
  private constructor(private readonly deps: OcsfSiemPushDependencies) {}

  static create(deps: OcsfSiemPushDependencies): OcsfSiemPushService {
    return new OcsfSiemPushService(deps);
  }

  async insertEvent(row: GovernanceOcsfEvent): Promise<void> {
    await this.insertEvents([row]);
  }

  async insertEvents(rows: GovernanceOcsfEvent[]): Promise<void> {
    await this.deps.events.insertEvents(rows);
    const byTenant = new Map<string, GovernanceOcsfEvent[]>();
    for (const row of rows) {
      if (row.sourceType === OCSF_PUSHED_SOURCE_TYPE) continue;
      const bucket = byTenant.get(row.tenantId);
      if (bucket) bucket.push(row);
      else byTenant.set(row.tenantId, [row]);
    }
    for (const [tenantId, tenantRows] of byTenant) {
      await this.queue({ tenantId, rows: tenantRows });
    }
  }

  private async queue({
    tenantId,
    rows,
  }: {
    tenantId: string;
    rows: GovernanceOcsfEvent[];
  }): Promise<void> {
    const outbox = this.deps.outbox();
    if (!outbox || rows.length === 0) return;
    const organizationId = await this.deps.projects.getOrganizationId(tenantId);
    const endpoints = (await this.deps.webhooks.getAll({ organizationId })).filter(
      (endpoint) =>
        endpoint.status === "ACTIVE" && eventMatches(endpoint.enabledEvents, OCSF_EVENT_TYPE),
    );
    if (endpoints.length === 0) return;
    if (!(await this.deps.entitlements.hasEnterprisePlan(organizationId))) return;

    const intents = rows.flatMap((row) => {
      const body = governanceRowToOcsfEvent({
        row: governanceOcsfExportRowOf(row),
        organizationId,
      });
      return endpoints.map((endpoint) => ({
        organizationId,
        endpointId: endpoint.id,
        eventId: row.eventId,
        body,
      }));
    });
    await outbox.record(intents);
  }
}
