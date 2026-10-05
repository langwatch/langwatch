import type { TraceApi } from "@langwatch/trace-contract";

import { toReportTraceRow } from "../rules/report-trace-row.rules.ts";
import type { ReportDispatchDeps } from "./report-dispatch.service.ts";

type ReportTraceListInput = Parameters<ReportDispatchDeps["listReportTraces"]>[0];

/** Main's `listReportTraces` (presets.ts): the author's query compiled onto the trace grid read. */
export class ReportTraceListService {
  static create(input: {
    traces: Pick<TraceApi, "readTraceList" | "translateTraceFilter">;
    baseHost: string;
  }): ReportTraceListService {
    return new ReportTraceListService(input.traces, input.baseHost);
  }

  private constructor(
    private readonly traces: Pick<TraceApi, "readTraceList" | "translateTraceFilter">,
    private readonly baseHost: string,
  ) {}

  async list({
    projectId,
    projectSlug,
    query,
    from,
    to,
    limit,
  }: ReportTraceListInput): ReturnType<ReportDispatchDeps["listReportTraces"]> {
    const filterWhere = this.traces.translateTraceFilter({
      query,
      tenantId: projectId,
      timeRange: { from, to },
    });
    const page = await this.traces.readTraceList({
      tenantId: projectId,
      timeRange: { from, to },
      sort: { columnId: "time", direction: "desc" },
      page: 1,
      pageSize: limit,
      visibilityCutoffMs: null,
      ...(filterWhere ? { filterWhere } : {}),
    });
    const projectUrl = `${this.baseHost}/${projectSlug}`;
    return page.items.map((item) => toReportTraceRow({ item, projectUrl }));
  }
}
