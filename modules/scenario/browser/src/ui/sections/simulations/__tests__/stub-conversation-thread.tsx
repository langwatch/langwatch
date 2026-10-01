/**
 * A synchronous stand-in for the thread trace lends: turns from the trace kit,
 * and this module's own media, audio playback and turn separators drawn as
 * handed in. How trace draws each part is covered by trace's own suite.
 */
import type { UiConversationThreadProps } from "@langwatch/browser-host/declarations";
import { type DisplayPart, groupIntoTurns } from "@langwatch/trace-browser-kit";

export function StubConversationThread({
  parts,
  variant,
  projectId,
  live = false,
  renderMediaPart,
  renderTurnSeparator,
  audioPlaybackFor,
}: UiConversationThreadProps) {
  const drawPart = (part: DisplayPart) => {
    if (part.kind === "media") {
      return (
        <div key={part.id}>
          {renderMediaPart({ part: part.part, projectId, audioPlayback: audioPlaybackFor?.(part) })}
          {part.transcript && <em>{part.transcript}</em>}
        </div>
      );
    }
    if (part.kind === "text") return <p key={part.id}>{part.content}</p>;
    return <div key={part.id} data-part-kind={part.kind} />;
  };

  if (variant === "compact") return <>{parts.map(drawPart)}</>;
  return (
    <>
      {groupIntoTurns(parts, { live }).map((turn) => (
        <div key={turn.key}>
          {turn.turnNumber != null &&
            renderTurnSeparator?.({ index: turn.turnNumber, traceId: turn.traceId, live })}
          {turn.parts.map(drawPart)}
        </div>
      ))}
    </>
  );
}
