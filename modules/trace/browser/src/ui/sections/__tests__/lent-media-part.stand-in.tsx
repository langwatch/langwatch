/**
 * Scenario's lent media renderer, stood in for trace's tests by an element per
 * part kind. Scenario's own tests cover the real renderer.
 */
import type { MediaPartProps } from "@langwatch/scenario-contract";

export function LentMediaPart({ part }: MediaPartProps) {
  if (part.type === "binary") return <span data-testid="media-part-binary">{part.filename}</span>;
  if (part.type === "image")
    return <img data-testid="media-part-image" src={part.source.value} alt="" />;
  if (part.type === "audio")
    return (
      <audio data-testid="media-part-audio" src={part.source.value}>
        <track kind="captions" />
      </audio>
    );
  return (
    <video data-testid="media-part-video" src={part.source.value}>
      <track kind="captions" />
    </video>
  );
}
