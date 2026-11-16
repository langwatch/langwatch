// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  decodeOcsfAuditCursor,
  decodeOcsfGovernanceCursor,
  decodeOcsfTracesCursor,
  encodeOcsfCursor,
  GovernanceValidationError,
  OCSF_EXPORT_SCHEMA_VERSION,
  OCSF_INGEST_MAX_FUTURE_MS,
  OCSF_PUSHED_SOURCE_TYPE,
  type OcsfEventsPage,
  type OcsfIngestRequest,
  type OcsfIngestResponse,
  type OcsfTracesCursor,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

import type {
  GovernanceOcsfEvent,
  GovernanceOcsfEventSink,
  GovernanceOcsfEventsReader,
} from "../../../repositories/governance.repositories.ts";
import {
  auditEntryToOcsfEvent,
  governanceRowToOcsfEvent,
  projectTraceToOcsfEvent,
} from "../rules/ocsf-v1-9-event.rules.ts";

/** Projects one traces page may step through when they hold nothing in the window. */
const EMPTY_PROJECTS_PER_PAGE = 20;

type ExportWindow = { limit: number; since?: string; until?: string; cursor?: string };

type OcsfSiemExportDependencies = {
  events: GovernanceOcsfEventsReader & GovernanceOcsfEventSink;
  projects: Pick<
    ProjectApi,
    "findInternal" | "ensureInternal" | "findLiveNonGovernanceIdsByOrganization"
  >;
  traces: Pick<TraceApi, "listTraceSummaries">;
  auditLog: Pick<AuditLogApi, "findForOrganization">;
  now: () => number;
};

function toEpochMs(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}

function sinceMs(iso: string | undefined): number {
  return iso === undefined ? 0 : toEpochMs(iso);
}

function getCursor<T>(value: string, decode: (cursor: string) => T | undefined): T {
  const decoded = decode(value);
  if (decoded === undefined) {
    const complaint = "Not a cursor this route issued; pass back next_cursor unchanged";
    throw new GovernanceValidationError(complaint, { formErrors: [complaint] });
  }
  return decoded;
}

/** Where a traces cursor resumes the walk; past the end when its project is gone and none follow. */
function resumePoint({
  walk,
  cursor,
}: {
  walk: readonly string[];
  cursor: OcsfTracesCursor | undefined;
}): { index: number; scrollId: string | null } {
  const resumeAt = cursor?.p;
  if (!resumeAt) return { index: 0, scrollId: null };
  const index = walk.findIndex((id) => id >= resumeAt);
  if (index < 0) return { index: walk.length, scrollId: null };
  return { index, scrollId: walk[index] === resumeAt ? cursor.s : null };
}

/**
 * Reads the first project of the walk, from the cursor on, that holds traces in the window. When
 * the walk ends, the cursor opens the next window where this one ended.
 */
async function walkProjects({
  traces,
  walk,
  cursor,
  fromMs,
  toMs,
  limit,
  organizationId,
}: {
  traces: Pick<TraceApi, "listTraceSummaries">;
  walk: readonly string[];
  cursor: OcsfTracesCursor | undefined;
  fromMs: number;
  toMs: number;
  limit: number;
  organizationId: string;
}): Promise<{ data: OcsfEventsPage["data"]; next: OcsfTracesCursor }> {
  let { index, scrollId } = resumePoint({ walk, cursor });
  const windowEnd: OcsfTracesCursor = { p: null, s: null, f: toMs, t: null };
  for (let visited = 0; visited < EMPTY_PROJECTS_PER_PAGE; visited += 1) {
    const projectId = walk[index];
    if (projectId === undefined) return { data: [], next: windowEnd };
    const page = await traces.listTraceSummaries({
      query: { projectId, startDate: fromMs, endDate: toMs, pageSize: limit },
      options: { dateField: "updated", scrollId },
    });
    const data = page.summaries.map((summary) =>
      projectTraceToOcsfEvent({ summary, projectId, organizationId }),
    );
    const nextProject = page.scrollId ? projectId : walk[index + 1];
    const next: OcsfTracesCursor = nextProject
      ? { p: nextProject, s: page.scrollId ?? null, f: fromMs, t: toMs }
      : windowEnd;
    if (data.length > 0 || !nextProject) return { data, next };
    index += 1;
    scrollId = null;
  }
  const resume = walk[index];
  return { data: [], next: resume ? { p: resume, s: null, f: fromMs, t: toMs } : windowEnd };
}

/**
 * The three OCSF export streams of an organisation, read with machine credentials, and the push-in
 * of OCSF events from another source. Every page is OCSF 1.9.0 and answers a cursor to resume from.
 * Spec: enterprise/modules/governance/specs/ocsf-siem.feature
 */
export class OcsfSiemExportService {
  private constructor(private readonly deps: OcsfSiemExportDependencies) {}

  static create(deps: OcsfSiemExportDependencies): OcsfSiemExportService {
    return new OcsfSiemExportService(deps);
  }

  /** Governance events: ingested traces, pulled provider events, admin views, pushed-in events. */
  async listEvents(
    input: ExportWindow & { organizationId: string; sourceType?: string; sourceId?: string },
  ): Promise<OcsfEventsPage> {
    const cursor =
      input.cursor === undefined ? undefined : getCursor(input.cursor, decodeOcsfGovernanceCursor);
    const watermark = cursor ?? { t: sinceMs(input.since), e: "" };
    const tenant = await this.deps.projects.findInternal({
      organizationId: input.organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    if (!tenant) return this.page({ data: [], cursor: watermark, hasMore: false });

    const untilMs = input.until === undefined ? undefined : toEpochMs(input.until);
    const rows = await this.deps.events.findAll({
      tenantId: tenant.id,
      sinceMs: watermark.t,
      sinceEventId: watermark.e,
      limit: input.limit + 1,
      ...(untilMs === undefined ? {} : { untilMs }),
      ...(input.sourceType === undefined ? {} : { sourceType: input.sourceType }),
      ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
    });
    const kept = rows.slice(0, input.limit);
    const last = kept.at(-1);
    return this.page({
      data: kept.map((row) =>
        governanceRowToOcsfEvent({ row, organizationId: input.organizationId }),
      ),
      cursor: last ? { t: last.eventTimeMs, e: last.eventId } : watermark,
      hasMore: rows.length > input.limit,
    });
  }

  /**
   * Project traces, one event per trace, walked project by project over a fixed window. When the
   * walk ends, the cursor opens the next window where this one ended.
   */
  async listProjectTraces(
    input: ExportWindow & { organizationId: string; projectId?: string },
  ): Promise<OcsfEventsPage> {
    const cursor =
      input.cursor === undefined ? undefined : getCursor(input.cursor, decodeOcsfTracesCursor);
    const projectIds = (
      await this.deps.projects.findLiveNonGovernanceIdsByOrganization({
        organizationId: input.organizationId,
      })
    ).toSorted();
    if (input.projectId !== undefined && !projectIds.includes(input.projectId)) {
      const complaint = "project_id is not a live project of this organisation";
      throw new GovernanceValidationError(complaint, { formErrors: [complaint] });
    }
    const walk = input.projectId === undefined ? projectIds : [input.projectId];
    const fromMs = cursor?.f ?? sinceMs(input.since);
    const toMs =
      cursor?.t ?? (input.until === undefined ? this.deps.now() : toEpochMs(input.until));
    const { data, next } = await walkProjects({
      traces: this.deps.traces,
      walk,
      cursor,
      fromMs,
      toMs,
      limit: input.limit,
      organizationId: input.organizationId,
    });
    return this.page({ data, cursor: next, hasMore: next.p !== null });
  }

  /** The organisation's audit log, oldest first. */
  async listAudit(input: ExportWindow & { organizationId: string }): Promise<OcsfEventsPage> {
    const cursor =
      input.cursor === undefined ? undefined : getCursor(input.cursor, decodeOcsfAuditCursor);
    const watermark = cursor ?? { t: sinceMs(input.since), i: "" };
    const projectIds = await this.deps.projects.findLiveNonGovernanceIdsByOrganization({
      organizationId: input.organizationId,
    });
    const untilMs = input.until === undefined ? undefined : toEpochMs(input.until);
    const entries = await this.deps.auditLog.findForOrganization({
      organizationId: input.organizationId,
      projectIds,
      afterMs: watermark.t,
      afterId: watermark.i,
      limit: input.limit + 1,
      ...(untilMs === undefined ? {} : { untilMs }),
    });
    const kept = entries.slice(0, input.limit);
    const last = kept.at(-1);
    return this.page({
      data: kept.map((entry) =>
        auditEntryToOcsfEvent({ entry, organizationId: input.organizationId }),
      ),
      cursor: last ? { t: last.createdAt.getTime(), i: last.id } : watermark,
      hasMore: entries.length > input.limit,
    });
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

  private page({
    data,
    cursor,
    hasMore,
  }: {
    data: OcsfEventsPage["data"];
    cursor: Record<string, unknown>;
    hasMore: boolean;
  }): OcsfEventsPage {
    return {
      ocsf_version: OCSF_EXPORT_SCHEMA_VERSION,
      data,
      next_cursor: encodeOcsfCursor(cursor),
      has_more: hasMore,
    };
  }
}
