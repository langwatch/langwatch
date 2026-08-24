import type { GovernanceOcsfExportPage } from "@langwatch/enterprise-governance-contract";
import type {
  GovernanceOcsfEventsReaderPort,
  GovernanceOcsfExportRepository,
} from "../ports/ocsf-export.port";

export class GovernanceOcsfExportService {
  private constructor(
    private readonly repository: GovernanceOcsfExportRepository,
    private readonly events: GovernanceOcsfEventsReaderPort | undefined,
  ) {}

  static create(options: {
    repository: GovernanceOcsfExportRepository;
    events?: GovernanceOcsfEventsReaderPort;
  }): GovernanceOcsfExportService {
    return new GovernanceOcsfExportService(
      options.repository,
      options.events,
    );
  }

  async list(input: {
    organizationId: string;
    sinceMs: number;
    sinceEventId?: string;
    limit: number;
  }): Promise<GovernanceOcsfExportPage> {
    const tenantId = await this.repository.resolveGovernanceTenantId(
      input.organizationId,
    );
    if (!tenantId) {
      return { events: [], nextCursor: null, nextCursorCompound: null };
    }
    if (!this.events) throw new Error("OCSF event storage is not configured");

    const events = await this.events.findAll({
      tenantId,
      sinceMs: input.sinceMs,
      sinceEventId: input.sinceEventId ?? "",
      limit: input.limit,
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
