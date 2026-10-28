/** One offloaded field: which trace event recorded it, and under which name. */
export type OffloadedFieldReference = Readonly<{
  traceId: string;
  eventId: string;
  field: string;
}>;

/** The map key a recall answers under; the NUL separator cannot collide with ids. */
export function offloadedFieldKey({ traceId, eventId, field }: OffloadedFieldReference): string {
  return `${traceId}\u0000${eventId}\u0000${field}`;
}
