import type { MediaPartData } from "@langwatch/trace-contract";

import { TraceMediaStrip as TraceMediaStripView } from "../../elements/trace-media-strip.tsx";
import { TraceMediaPart } from "./trace-media-part.tsx";

/** Compatibility adapter for app callers that still resolve the old path. */
export function TraceMediaStrip({ parts }: { parts: MediaPartData[] }) {
  return (
    <TraceMediaStripView parts={parts} renderPart={(part) => <TraceMediaPart part={part} />} />
  );
}
