import {
  MediaPart as SimulationMediaPart,
  type MediaPartProps,
  type MediaProbeResult,
} from "@langwatch/scenario-web/surfaces/media-part";
import { useEffect, useState } from "react";
import { api } from "../../../behavior/trace-api.ts";

/** Where the part's bytes live: a binary's own url, or a url-typed source. */
function urlOfPart(part: MediaPartProps["part"]): string | undefined {
  if (part.type === "binary") return part.url;
  return part.source.type === "url" ? part.source.value : undefined;
}

function storedObjectIdForPart(part: MediaPartProps["part"]): string | undefined {
  const url = urlOfPart(part);
  const match = url ? /^\/api\/files\/(?:[^/?#]+\/)?([^/?#]+)/.exec(url) : undefined;
  return match?.[1];
}

/** App composition adapter for the feature-owned media renderer. */
export function MediaPart(props: MediaPartProps) {
  const storedObjectId = storedObjectIdForPart(props.part);
  const [probeEnabled, setProbeEnabled] = useState(false);
  useEffect(() => {
    setProbeEnabled(false);
  }, [storedObjectId]);
  const probe = api.storedObjects.headById.useQuery(
    { projectId: props.projectId, id: storedObjectId ?? "" },
    { enabled: probeEnabled && !!storedObjectId && !!props.projectId },
  );
  const probeResult: MediaProbeResult = probe.isError ? null : probe.data;

  return (
    <SimulationMediaPart
      {...props}
      probe={probeResult}
      onProbeRequired={() => setProbeEnabled(true)}
    />
  );
}
