import { TraceMediaStrip as TraceMediaStripView } from "../../../index";
import type { MediaPartData } from "../../../behavior/shared/traces/media-parts";
import { TraceMediaPart } from "./trace-media-part";

/** Compatibility adapter for app callers that still resolve the old path. */
export function TraceMediaStrip({ parts }: { parts: MediaPartData[] }) {
  return (
    <TraceMediaStripView parts={parts} renderPart={(part) => <TraceMediaPart part={part} />} />
  );
}
