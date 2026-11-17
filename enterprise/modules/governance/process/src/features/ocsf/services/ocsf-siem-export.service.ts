// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { AUDIT_LOG_EXPORT_PAGE_MAX, type AuditLogApi } from "@langwatch/audit-log-contract";
import {
  decodeOcsfAuditCursor,
  decodeOcsfGovernanceCursor,
  decodeOcsfTracesCursor,
  encodeOcsfCursor,
  GovernanceValidationError,
  OCSF_EXPORT_SCHEMA_VERSION,
  type OcsfEventsPage,
  type OcsfTracesCursor,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";

import type { OcsfIngestOrderedReader } from "../../../repositories/governance.repositories.ts";
import { auditEntryToOcsfEvent } from "../rules/ocsf-v1-9-audit.rules.ts";
import {
  governanceRowToOcsfEvent,
  projectTraceToOcsfEvent,
} from "../rules/ocsf-v1-9-event.rules.ts";

/** Audit rows are stamped at commit and written later; a page reads only rows this old. */
export const AUDIT_SETTLE_MS = 10 * 60 * 1000;

/** Projects one traces page may step through when they hold nothing in the window. */
const EMPTY_PROJECTS_PER_PAGE = 20;

type ExportWindow = { limit: number; since?: string; until?: string; cursor?: string };

type OcsfSiemExportDependencies = {
  events: OcsfIngestOrderedReader;
  projects: Pick<ProjectApi, "findInternal" | "findLiveNonGovernanceIdsByOrganization">;
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
 * Reads the first project of the walk, from the cursor on, that holds traces in the window. Every
 * cursor carries the lowest bound a read of this walk covered, and the next window opens there.
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
  let covered = Math.min(cursor?.t ?? toMs, toMs);
  const resumeAt = (project: string, scroll: string | null): OcsfTracesCursor => ({
    p: project,
    s: scroll,
    f: fromMs,
    t: covered,
  });
  const windowEnd = (): OcsfTracesCursor => ({ p: null, s: null, f: covered, t: null });
  for (let visited = 0; visited < EMPTY_PROJECTS_PER_PAGE; visited += 1) {
    const projectId = walk[index];
    if (projectId === undefined) return { data: [], next: windowEnd() };
    const page = await traces.listTraceSummaries({
      query: { projectId, startDate: fromMs, endDate: toMs, pageSize: limit },
      options: { dateField: "updated", scrollId },
    });
    covered = Math.min(covered, page.updatedThrough ?? toMs);
    const data = page.summaries.map((summary) =>
      projectTraceToOcsfEvent({ summary, projectId, organizationId }),
    );
    const nextProject = page.scrollId ? projectId : walk[index + 1];
    const next = nextProject ? resumeAt(nextProject, page.scrollId ?? null) : windowEnd();
    if (data.length > 0 || !nextProject) return { data, next };
    index += 1;
    scrollId = null;
  }
  const resume = walk[index];
  return { data: [], next: resume ? resumeAt(resume, null) : windowEnd() };
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
    const watermark = cursor ?? { t: 0, e: "" };
    const tenant = await this.deps.projects.findInternal({
      organizationId: input.organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    if (!tenant) return this.page({ data: [], cursor: watermark, hasMore: false });

    const untilMs = input.until === undefined ? undefined : toEpochMs(input.until);
    const rows = await this.deps.events.findAllByIngest({
      tenantId: tenant.id,
      afterIngestedMs: watermark.t,
      afterEventId: watermark.e,
      limit: input.limit + 1,
      ...(input.since === undefined ? {} : { sinceMs: toEpochMs(input.since) }),
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
      cursor: last ? { t: last.ingestedAtMs, e: last.eventId } : watermark,
      hasMore: rows.length > input.limit,
    });
  }

  /**
   * Project traces, one event per trace, walked project by project over a window that ends no
   * later than now. When the walk ends, the cursor opens the next window where every read of it
   * was covered, so a trace updated after a project's read is picked up by the next window.
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
    const now = this.deps.now();
    const requestedTo = input.until === undefined ? (cursor?.t ?? now) : toEpochMs(input.until);
    const toMs = Math.min(requestedTo, now);
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
    const settled = this.deps.now() - AUDIT_SETTLE_MS;
    const untilMs = Math.min(settled, input.until === undefined ? settled : toEpochMs(input.until));
    const pageSize = Math.min(input.limit, AUDIT_LOG_EXPORT_PAGE_MAX);
    const entries = await this.deps.auditLog.findForOrganization({
      organizationId: input.organizationId,
      projectIds,
      afterMs: watermark.t,
      afterId: watermark.i,
      limit: pageSize + 1,
      untilMs,
    });
    const kept = entries.slice(0, pageSize);
    const last = kept.at(-1);
    return this.page({
      data: kept.map((entry) =>
        auditEntryToOcsfEvent({ entry, organizationId: input.organizationId }),
      ),
      cursor: last ? { t: last.createdAt.getTime(), i: last.id } : watermark,
      hasMore: entries.length > pageSize,
    });
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
