import { useMemo } from "react";
import { ConversationThread } from "~/components/conversation/ConversationThread";
import { flattenMessages } from "~/components/conversation/flattenMessages";
import type { StreamingMessage } from "~/hooks/useSimulationStreamingState";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";

interface ScenarioMessageRendererProps {
  messages: ScenarioMessageSnapshotEvent["messages"];
  streamingMessages?: StreamingMessage[];
  variant: "grid" | "drawer";
  /** Project that owns the stored objects in this message thread. */
  projectId: string;
}

/**
 * A scenario run's transcript.
 *
 * The flattening and the rendering both live in `~/components/conversation`
 * now — this component's remaining job is to say which of them a scenario is:
 * roles are swapped (the `user` turns come from a simulated user, the
 * `assistant` turns from the agent under test), and a grid cell is a preview
 * rather than a transcript.
 */
export function ScenarioMessageRenderer({
  messages,
  streamingMessages,
  variant,
  projectId,
}: ScenarioMessageRendererProps) {
  const parts = useMemo(
    () => flattenMessages({ messages, streaming: streamingMessages }),
    [messages, streamingMessages],
  );

  return (
    <ConversationThread
      parts={parts}
      variant={variant === "grid" ? "compact" : "regular"}
      roleMode="scenario"
      projectId={projectId}
      // A grid card is a preview the reader scans, not a thread they follow.
      // Every card smooth-scrolling itself on each batch of incoming messages
      // made the whole grid twitch.
      autoScroll={variant !== "grid"}
    />
  );
}
