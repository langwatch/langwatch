import { TraceSpanSpoolPort, type TraceSpanSpoolIdentity } from "../ports/trace-span-spool.port";
import { TraceSpoolService } from "../services/trace-spool.service";

/**
 * Renames the spool service onto the narrow port `RecordSpanCommand` names.
 *
 * The service is not a subclass of the port and must not become one: `putSpool`
 * belongs to the ingestion edge, which is a different process from the command
 * worker that reads and deletes. The port carries only the two the worker calls.
 */
export class TraceSpanSpoolAdapter extends TraceSpanSpoolPort {
  static create(spool: TraceSpoolService): TraceSpanSpoolAdapter {
    return new TraceSpanSpoolAdapter(spool);
  }

  private constructor(private readonly spool: TraceSpoolService) {
    super();
  }

  /** The application decodes the spooled command body as UTF-8; so does this. */
  async read(identity: TraceSpanSpoolIdentity): Promise<string> {
    const body = await this.spool.getSpool(identity);
    return body.toString("utf8");
  }

  async delete(identity: TraceSpanSpoolIdentity): Promise<void> {
    await this.spool.deleteSpool(identity);
  }
}
