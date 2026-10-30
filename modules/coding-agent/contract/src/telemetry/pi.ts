import type { CodingAgentDefinition } from "./coding-agent-definition.ts";

/**
 * pi (ADR-188): declares its own span tree and dual-writes every model-call
 * attribute, pi's key beside the GenAI convention key. Spans are its only
 * signal, so model calls and tool runs both fold from spans.
 */
export const piAgent: CodingAgentDefinition = {
  id: "pi",

  // Name prefix only, never `signalSays`: that also tests scope and service,
  // and `pi` is a substring of both `copilot` and `anthropic`.
  matches: (signal) => signal.name.startsWith("pi."),
  namePrefixes: ["pi."],

  // Also the admission list: a harness span neither listed here nor holding a
  // declared GenAI role is dropped at the pipeline filter. `pi.harness.compaction`
  // is listed because pi 0.84.2 fires `session_before_compact`/`session_compact`.
  sessionSpanNames: ["pi.harness.run", "pi.harness.turn", "pi.harness.compaction"],

  // pi's own span names, verbatim: `genAiOperationRoleOf` compares the first
  // space-delimited word of the span name, and pi's names carry no space.
  genAiOperations: {
    session: "pi.harness.run",
    modelCall: "pi.ai.request",
    toolRun: "pi.harness.tool",
  },

  deriveSessionKeyFromSpan: ({ attrs }) => {
    const sessionId = attrs["pi.session.id"];
    return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  },

  spansRequireSessionKey: true,
  modelCallsOnSpansOnly: true,
  surfaceBySourceType: { pi_cli: "cli" },
};
