export type {
  ConversationRoleMode,
  ConversationTurn,
  DisplayPart,
} from "@langwatch/trace-contract/conversation";

/**
 * Playback coordination for one audio part, as the host's sequential player
 * hands it out. Structural on purpose: the thread never starts a clip, it only
 * passes the props through to whatever draws the media.
 */
export interface ConversationAudioPlayback {
  ref: (element: HTMLAudioElement | null) => void;
  onPlay: () => void;
  onEnded: () => void;
}
