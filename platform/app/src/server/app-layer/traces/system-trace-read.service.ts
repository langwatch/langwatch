import type { Trace } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";

/**
 * The single read this service delegates to — `TraceService.getById`. Narrowed
 * to one method so the service can be exercised without a ClickHouse-backed
 * trace service.
 */
export interface ProtectedTraceReader {
  getById(
    projectId: string,
    traceId: string,
    protections: Protections,
  ): Promise<Trace | undefined>;
}

export interface SystemTraceReadServiceDeps {
  traces: ProtectedTraceReader;
  /**
   * Resolves a project's field-redaction protections for a caller that has no
   * user session (background work acting at API-key-holder level).
   */
  resolveProtections: (projectId: string) => Promise<Protections>;
}

/**
 * Reads whole traces on behalf of background work — automation dispatch fills
 * alert templates through it, once per matched trace per digest.
 *
 * The protections lookup is the reason this is a service rather than two calls
 * at the call site: it is a per-project query that the hot path would otherwise
 * repeat for every trace in a digest. Concurrent lookups for the same project
 * share one in-flight query, and the entry is dropped the moment that query
 * settles — so this coalesces a burst, it does not cache. A project whose data
 * privacy policy changes is picked up by the next read that starts after the
 * change.
 */
export class SystemTraceReadService {
  private readonly protectionsInFlight = new Map<
    string,
    Promise<Protections>
  >();

  constructor(private readonly deps: SystemTraceReadServiceDeps) {}

  async getById({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<Trace | undefined> {
    const protections = await this.protectionsFor(projectId);
    return this.deps.traces.getById(projectId, traceId, protections);
  }

  private protectionsFor(projectId: string): Promise<Protections> {
    const inFlight = this.protectionsInFlight.get(projectId);
    if (inFlight) return inFlight;

    const resolving = this.deps
      .resolveProtections(projectId)
      .finally(() => this.protectionsInFlight.delete(projectId));
    this.protectionsInFlight.set(projectId, resolving);
    return resolving;
  }
}
