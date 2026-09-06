import { TraceMediaStrip as TraceMediaStripView } from "../../elements/trace-media-strip.tsx";
import type { MediaPartData } from "../../../behavior/shared/traces/media-parts.ts";
import { TraceMediaPart } from "./trace-media-part.tsx";

/** Compatibility adapter for app callers that still resolve the old path. */
export function TraceMediaStrip({ parts }: { parts: MediaPartData[] }) {
  return (
    <TraceMediaStripView parts={parts} renderPart={(part) => <TraceMediaPart part={part} />} />
  );
}
