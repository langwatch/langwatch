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
      const text =
        typeof lastMessage.content === "string"
          ? lastMessage.content
          : Array.isArray(lastMessage.content)
            ? lastMessage.content
                .filter((p: any) => p?.type === "text")
                .map((p: any) => p.text)
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
          let event: any;
          try { event = JSON.parse(line); }
          catch { continue; }
          // Capture session id for the next turn — mirrors the langy.ts behavior.
          if (event.type === "langy.session" && typeof event.sessionId === "string") {
            state.sessionId = event.sessionId;
            continue;
          }
          // Pull text from any common shape.
          const delta = event.delta ?? event.text ?? event.part?.text
            ?? event.properties?.delta ?? event.properties?.text
            ?? event.properties?.part?.text;
          if (typeof delta === "string") assistantText += delta;
        }
      }
      return { role: "assistant", content: assistantText || "(no response)" };
    },
  };
  return Object.assign(adapter, { state });
}
