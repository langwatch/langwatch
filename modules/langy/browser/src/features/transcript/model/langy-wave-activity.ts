import type { LangyWaveActivity } from "../../../model/langy-wave-motion.ts";
import {
  currentTurnAssistant,
  hasTokens,
  runningTool,
  type ThinkingMessage,
} from "./langy-thinking-line.ts";

/**
 * Map Langy's live turn signals to the fold's activity state.
 */
export function deriveWaveActivity({
  turnInFlight,
  isSettling,
  hasLiveReasoning,
  messages,
}: {
  /** A turn is live (transport busy OR the durable running-turn signal). */
  turnInFlight: boolean;
  /** The turn failed, or a quiet auto-recovery is pending. */
  isSettling: boolean;
  /** Reasoning deltas are on the wire right now. */
  hasLiveReasoning: boolean;
  messages: ThinkingMessage[];
}): LangyWaveActivity {
  if (isSettling) return "settling";
  if (!turnInFlight) return "idle";
  const last = currentTurnAssistant(messages);
  if (runningTool(last)) return "tool";
  if (hasTokens(last)) return "streaming";
  if (hasLiveReasoning) return "thinking";
  return "waiting";
}
