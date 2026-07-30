import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { traceEvents } from "./events";
import type { OriginResolution } from "./schema";

export async function resolveOrigin(
  input: OriginResolution,
): Promise<readonly EmittedEvent<typeof traceEvents>[]> {
  return [{ type: "originResolved", data: input }];
}
