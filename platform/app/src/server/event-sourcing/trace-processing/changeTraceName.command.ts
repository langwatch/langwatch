import type { EmittedEvent } from "@langwatch/event-sourcing";
import { traceEvents } from "./events";
import type { TraceNameChange } from "./schema";

export async function changeTraceName(
  input: TraceNameChange,
): Promise<readonly EmittedEvent<typeof traceEvents>[]> {
  return [{ type: "traceNameChanged", data: input }];
}
