// AgentAdapter that hits Langy's pod wrapper via HTTP. Used by the scenario
// tests below. Maintains a sessionId between turns so we exercise the
// session-per-conversation path.

import type { AgentAdapter, AgentInput, AgentReturnTypes } from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";

const AGENT_URL = process.env.LANGY_AGENT_URL ?? "http://localhost:8081";

interface LangySessionState {
  sessionId: string | null;
}

export function makeLangyAdapter(): AgentAdapter & { state: LangySessionState } {
  const state: LangySessionState = { sessionId: null };
  const adapter: AgentAdapter = {
    role: AgentRole.AGENT,
    call: async (input: AgentInput): Promise<AgentReturnTypes> => {
      const lastMessage = input.messages[input.messages.length - 1];
      const text = !lastMessage
        ? ""
        : typeof lastMessage.content === "string"
          ? lastMessage.content
          : Array.isArray(lastMessage.content)
            ? (lastMessage.content as Array<{ type?: string; text?: string }>)
                .filter((p) => p?.type === "text")
                .map((p) => p.text ?? "")
                .join("")
            : "";

      const res = await fetch(`${AGENT_URL}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          sessionId: state.sessionId,
          system: null,
        }),
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) {
        throw new Error(`Langy /run returned ${res.status}: ${await res.text()}`);
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistantText = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let event: {
            type?: string;
            sessionId?: string;
            properties?: { field?: string; delta?: string };
          };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          // Capture session id for the next turn — mirrors the langy.ts behavior.
          if (event.type === "langy.session" && typeof event.sessionId === "string") {
            state.sessionId = event.sessionId;
            continue;
          }
          // Mirror langy.ts:316-327 exactly: only count text deltas emitted on
          // the assistant's text part. Any broader cascade (taking text from
          // `message.part.updated` or from `event.properties.part.text`) ends
          // up (a) capturing the user's own prompt echo, since user messages
          // arrive as the same shape, and (b) double-counting the assistant
          // text — once via the streaming `delta` and again via the final
          // `updated` event that carries the accumulated string. That is the
          // sole cause of the "doubled response" pattern seen in older
          // scenario-log transcripts; the in-product Langy was always clean.
          if (
            event.type === "message.part.delta" &&
            event.properties?.field === "text" &&
            typeof event.properties?.delta === "string"
          ) {
            assistantText += event.properties.delta;
          }
        }
      }
      return { role: "assistant", content: assistantText || "(no response)" };
    },
  };
  return Object.assign(adapter, { state });
}
