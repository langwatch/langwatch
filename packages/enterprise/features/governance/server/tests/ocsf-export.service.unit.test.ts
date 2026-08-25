import type { GovernanceOcsfExportRow } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it, vi } from "vitest";
import {
  GovernanceOcsfEventsReaderPort,
  GovernanceOcsfExportRepository,
} from "../src/ports/ocsf-export.port";
import { DefaultGovernanceOcsfExportService } from "../src/services/ocsf-export.service";

class FixedTenantRepository extends GovernanceOcsfExportRepository {
  constructor(private readonly tenantId: string | null) {
    super();
  }

  async tryResolveGovernanceTenantId(): Promise<string | null> {
    return this.tenantId;
  }
}

class FixedEventReader extends GovernanceOcsfEventsReaderPort {
  readonly findAll = vi.fn(async (): Promise<GovernanceOcsfExportRow[]> => []);
}

function event(eventId: string, eventTimeMs: number): GovernanceOcsfExportRow {
  return {
    eventId,
    ocsfSchemaVersion: "1.1.0",
    traceId: "trace",
    sourceId: "source",
    sourceType: "otel_generic",
    classUid: 6003,
    categoryUid: 6,
    activityId: 6,
    typeUid: 600306,
    severityId: 1,
    eventTimeMs,
    actorUserId: "user",
    actorEmail: "user@example.test",
    actorEnduserId: "end-user",
    actionName: "invoke",
    targetName: "model",
    anomalyAlertId: "",
    rawOcsfJson: "{}",
  };
}

describe("DefaultGovernanceOcsfExportService", () => {
  it("returns an empty page without reading events when no tenant exists", async () => {
    const events = new FixedEventReader();
    const page = await DefaultGovernanceOcsfExportService.create({
      repository: new FixedTenantRepository(null),
      events,
    }).list({ organizationId: "organization", sinceMs: 0, limit: 500 });

    expect(page).toEqual({
      events: [],
      nextCursor: null,
      nextCursorCompound: null,
    });
    expect(events.findAll).not.toHaveBeenCalled();
  });

  it("returns the final event as the compound cursor", async () => {
    const events = new FixedEventReader();
    events.findAll.mockResolvedValue([event("event-1", 100), event("event-2", 100)]);
    const page = await DefaultGovernanceOcsfExportService.create({
      repository: new FixedTenantRepository("tenant"),
      events,
    }).list({
      organizationId: "organization",
      sinceMs: 50,
      sinceEventId: "event-0",
      limit: 2,
    });

    expect(events.findAll).toHaveBeenCalledWith({
      tenantId: "tenant",
      sinceMs: 50,
      sinceEventId: "event-0",
      limit: 2,
    });
    expect(page.nextCursorCompound).toEqual({
      eventTimeMs: 100,
      eventId: "event-2",
    });
  });

  it("fails clearly when a tenant exists without event storage", async () => {
    await expect(
      DefaultGovernanceOcsfExportService.create({
        repository: new FixedTenantRepository("tenant"),
      }).list({ organizationId: "organization", sinceMs: 0, limit: 1 }),
    ).rejects.toThrow("OCSF event storage is not configured");
  });
});
