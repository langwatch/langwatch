import type { TraceSpanSpool, TraceSpanSpoolIdentity } from "../app/trace.infrastructure.ts";
import { TraceSpoolService } from "./ingestion/trace-spool.service.ts";

/**
 * Renames the spool service onto the narrow infrastructure `RecordSpanCommand` names.
 *
 * The service is not a subclass of the infrastructure member and must not become
 * one: `putSpool` belongs to the ingestion edge, which is a different process
 * from the command worker that reads and deletes. The infrastructure member
 * carries only the two the worker calls.
 */
export class TraceSpanSpoolAdapter implements TraceSpanSpool {
  static create(spool: TraceSpoolService): TraceSpanSpoolAdapter {
    return new TraceSpanSpoolAdapter(spool);
  }

  private constructor(private readonly spool: TraceSpoolService) {}

  /** The application decodes the spooled command body as UTF-8; so does this. */
  async read(identity: TraceSpanSpoolIdentity): Promise<string> {
    const body = await this.spool.getSpool(identity);
    return body.toString("utf8");
  }

  async delete(identity: TraceSpanSpoolIdentity): Promise<void> {
    await this.spool.deleteSpool(identity);
  }
}
