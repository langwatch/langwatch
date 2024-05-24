import { type Trace } from "~/server/tracer/types";

interface TraceGroups {
  groups: Trace[][];
}

export const getLatestUpdatedAt = (traces: TraceGroups) => {
  const updatedTimes = traces.groups
    .flatMap((group: any) =>
      group.map((item: any) => item.timestamps.updated_at)
    )
    .sort((a: number, b: number) => b - a);

  return updatedTimes[0];
};
