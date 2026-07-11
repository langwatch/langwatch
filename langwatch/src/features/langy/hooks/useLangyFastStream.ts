import { useEffect, useRef, useState } from "react";
import { decodeFastFrame } from "~/server/services/langy/streaming/langyFastStream";

/**
 * Stream B consumer (ADR-048): subscribes to a turn's raw-token fast-path SSE
 * (`GET /api/langy/conversations/:id/fast`) and accumulates the optimistic
 * answer text token-by-token. This is the SPEED channel — ephemeral, no replay;
 * a mid-stream refresh loses it and Stream A's durable buffer replays instead.
 *
 * Returns just the accumulated `text`. The panel reconciles it against the
 * durable useChat text via `reconcileOptimisticText` before rendering, so a
 * dropped token or a late subscribe can never show corrupted prose.
 *
 * `.ts` (not `.tsx`): a hook returns state, never JSX.
 */
export function useLangyFastStream({
  projectId,
  conversationId,
  turnId,
  enabled,
}: {
  projectId: string | undefined;
  conversationId: string | null;
  turnId: string | null;
  enabled: boolean;
}): { text: string } {
  const [text, setText] = useState("");
  const textRef = useRef("");

  useEffect(() => {
    // Reset for each new (conversation, turn) — the optimistic view is per-turn.
    textRef.current = "";
    setText("");

    if (!enabled || !projectId || !conversationId || !turnId) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch(
          `/api/langy/conversations/${conversationId}/fast?projectId=${encodeURIComponent(
            projectId,
          )}&turnId=${encodeURIComponent(turnId)}`,
          { signal: controller.signal, headers: { Accept: "text/event-stream" } },
        );
        if (!res.ok || !res.body) {
          void res.body?.cancel();
          return; // fall back to Stream A silently
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE frames are separated by a blank line.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const rawFrame of frames) {
            const dataLine = rawFrame
              .split("\n")
              .find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            const payload = dataLine.slice("data:".length).trim();
            const frame = decodeFastFrame(payload);
            if (!frame) continue;
            if ("token" in frame) {
              textRef.current += frame.token;
              setText(textRef.current);
            } else {
              // Terminal frame — the turn ended; stop reading.
              controller.abort();
              return;
            }
          }
        }
      } catch {
        // Aborted (unmount / turn change) or a network hiccup — Stream A covers
        // the durable answer, so a fast-path failure is never surfaced.
      }
    })();

    return () => controller.abort();
  }, [projectId, conversationId, turnId, enabled]);

  return { text };
}
