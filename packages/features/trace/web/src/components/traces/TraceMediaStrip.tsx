import { TraceMediaStrip as TraceMediaStripView } from "../../index";
import type { MediaPartData } from "../../shared/traces/mediaParts";
import { TraceMediaPart } from "./TraceMediaPart";

/** Compatibility adapter for app callers that still resolve the old path. */
export function TraceMediaStrip({ parts }: { parts: MediaPartData[] }) {
  return (
    <TraceMediaStripView
      parts={parts}
      renderPart={(part) => <TraceMediaPart part={part} />}
    />
  );
}
