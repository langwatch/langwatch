export class TraceNotFoundError extends Error {
  constructor(readonly traceId: string) {
    super(`Trace ${traceId} was not found`);
    this.name = "TraceNotFoundError";
  }
}
