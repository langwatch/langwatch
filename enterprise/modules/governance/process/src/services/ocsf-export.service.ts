import {
  governanceOcsfExportInputSchema,
  type GovernanceOcsfExportInput,
  type GovernanceOcsfExportPage,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";

import type { GovernanceOcsfEventsReader } from "../app/governance.members.ts";

export class DefaultGovernanceOcsfExportService {
  private constructor(
    private readonly projects: Pick<ProjectApi, "findInternal">,
    private readonly events: GovernanceOcsfEventsReader | undefined,
  ) {}

  static create(options: {
    projects: Pick<ProjectApi, "findInternal">;
    events?: GovernanceOcsfEventsReader;
  }): DefaultGovernanceOcsfExportService {
    return new DefaultGovernanceOcsfExportService(options.projects, options.events);
  }

  async list(input: GovernanceOcsfExportInput): Promise<GovernanceOcsfExportPage> {
    const parsed = governanceOcsfExportInputSchema.parse(input);
    const tenantId = (
      await this.projects.findInternal({
        organizationId: parsed.organizationId,
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      })
    )?.id;
    if (!tenantId) {
      return { events: [], nextCursor: null, nextCursorCompound: null };
    }

    if (!this.events) {
      throw new Error("OCSF event storage is not configured");
    }

    const events = await this.events.findAll({
      tenantId,
      sinceMs: parsed.sinceMs,
      sinceEventId: parsed.sinceEventId ?? "",
      limit: parsed.limit,
    });
    const lastEvent = events.at(-1);

    return {
      events,
      nextCursor: lastEvent?.eventTimeMs ?? null,
      nextCursorCompound: lastEvent
        ? { eventTimeMs: lastEvent.eventTimeMs, eventId: lastEvent.eventId }
        : null,
    };
  }
}
