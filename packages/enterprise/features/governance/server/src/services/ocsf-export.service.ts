import {
  governanceOcsfExportInputSchema,
  type GovernanceOcsfExportInput,
  type GovernanceOcsfExportPage,
} from "@langwatch/enterprise-governance-contract";
import type {
  GovernanceOcsfEventsReaderPort,
  GovernanceOcsfExportRepository,
} from "../ports/ocsf-export.port";

export class DefaultGovernanceOcsfExportService {
  private constructor(
    private readonly repository: GovernanceOcsfExportRepository,
    private readonly events: GovernanceOcsfEventsReaderPort | undefined,
  ) {}

  static create(options: {
    repository: GovernanceOcsfExportRepository;
    events?: GovernanceOcsfEventsReaderPort;
  }): DefaultGovernanceOcsfExportService {
    return new DefaultGovernanceOcsfExportService(options.repository, options.events);
  }

  async list(input: GovernanceOcsfExportInput): Promise<GovernanceOcsfExportPage> {
    const parsed = governanceOcsfExportInputSchema.parse(input);
    const tenantId = await this.repository.tryResolveGovernanceTenantId(parsed.organizationId);
    if (!tenantId) {
      return { events: [], nextCursor: null, nextCursorCompound: null };
    }
    if (!this.events) throw new Error("OCSF event storage is not configured");

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
