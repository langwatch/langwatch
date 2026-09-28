import type { MediaPartData } from "@langwatch/trace-contract";

/** The stored-object existence probe the host runs for a media part. */
export type MediaProbeResult =
  | { status: "available"; mediaType: string }
  | { status: "missing"; mediaType: string }
  | { status: "not_found" }
  | null
  | undefined;

/** The props an audio element spreads so only one plays at a time. */
export interface MediaAudioPlayback {
  ref: (el: HTMLAudioElement | null) => void;
  onPlay: () => void;
  onEnded: () => void;
}

/** What scenario's media renderer takes, lent to the modules that show media. */
export interface MediaPartProps {
  part: MediaPartData;
  /** Project that owns this stored object. Required for the server-side existence probe. */
  projectId: string;
  /** Playback coordination; without it the audio element plays standalone. */
  audioPlayback?: MediaAudioPlayback;
  /** Result of the app-owned stored-object existence probe. */
  probe?: MediaProbeResult;
  /** Called once after a stored media element fails to load. */
  onProbeRequired?: (storedObjectId: string) => void;
}
