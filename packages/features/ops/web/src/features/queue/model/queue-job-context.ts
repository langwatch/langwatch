import type { OpsQueueJob as JobEntry } from "@langwatch/ops-contract";

/**
 * The request context a job carries in its `__context` machinery field —
 * stamped at enqueue so the worker can restore tracing and tenant identity.
 * The structured job view surfaces it because it answers the operator's first
 * three questions (whose job, which request, which user) without reading JSON.
 */
export interface JobContextInfo {
  traceId: string | null;
  projectId: string | null;
  userId: string | null;
  organizationId: string | null;
}

function readString(rec: Record<string, unknown>, key: string): string | null {
  const value = rec[key];
  return typeof value === "string" && value !== "" ? value : null;
}

export function readJobContext(data: Record<string, unknown> | null): JobContextInfo | null {
  const ctx = data?.__context;
  if (!isRecord(ctx)) return null;

  const info: JobContextInfo = {
    traceId: readString(ctx, "traceId"),
    projectId: readString(ctx, "projectId"),
    userId: readString(ctx, "userId"),
    organizationId: readString(ctx, "organizationId"),
  };
  const hasAny = info.traceId ?? info.projectId ?? info.userId ?? info.organizationId;
  return hasAny ? info : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The routing identity of a job, read from its machinery fields. */
export interface JobKindInfo {
  jobType: string | null;
  jobName: string | null;
  pipelineName: string | null;
}

export function readJobKind(data: Record<string, unknown> | null): JobKindInfo {
  if (!data) return { jobType: null, jobName: null, pipelineName: null };
  const rec = data;
  return {
    jobType: typeof rec.__jobType === "string" ? rec.__jobType : null,
    jobName: typeof rec.__jobName === "string" ? rec.__jobName : null,
    pipelineName: typeof rec.__pipelineName === "string" ? rec.__pipelineName : null,
  };
}

/**
 * Text filter over one PAGE of jobs — the server pages, the filter narrows
 * what is on screen. Matches the job id, anywhere in the payload, or the
 * blob hash.
 */
export function jobMatchesFilter(job: JobEntry, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  if (job.jobId.toLowerCase().includes(needle)) return true;
  if (job.data && JSON.stringify(job.data).toLowerCase().includes(needle)) return true;
  return job.envelope?.blobId?.toLowerCase().includes(needle) ?? false;
}
