import type { CodingAgentDefinition } from "./_types";

/** The exact `service.name` our own capture stamps on every pi record. */
const PI_SERVICE_NAME = "pi";

/**
 * pi. Captured by reading its session file rather than from telemetry pi
 * exports, so the signal is entirely ours: names namespaced `pi.`, resource
 * `service.name: pi`, and no `anthropic` anywhere — the record names the
 * AGENT, never the provider that answered it (ADR-132 §4, the `langy`
 * precedent).
 *
 * Matched WITHOUT `signalSays`, which every sibling here uses. That helper
 * tests the scope and service for the needle as a SUBSTRING, and `pi` is a
 * substring of both `anthropic` and `copilot`: scope
 * `com.anthropic.claude_code.events` and service `copilot-cli` both answer
 * true to a bare `pi`, which would relabel every Claude Code, Cowork and
 * Copilot record as pi. Verified by execution, not by reading. So both arms
 * below are delimited — a dotted name prefix and an EXACT service name — and
 * neither can fire on a string that merely contains the letters.
 */
export const piAgent: CodingAgentDefinition = {
  id: "pi",
  matches: (signal) =>
    signal.name.startsWith("pi.") || signal.service === PI_SERVICE_NAME,
  namePrefixes: ["pi."],

  // pi's session file is a sequence of messages with no trace or span ids;
  // emitting spans would mean inventing parentage pi never gave us. Events
  // only, so the session fold takes its model calls and tool runs from them
  // — the same path claude_cowork runs end to end.
  logsOnly: true,

  // pi stamps its session id on every event it emits — the builder refuses to
  // produce any event for a file without a session header — so a pi record
  // that arrives without a session key is not a session at all, and must not
  // be keyed on a trace instead. Same reasoning codex carries.
  //
  // Stated for intent, not to fix a live bug: pi resolves to providerKind
  // "generic" in canonicalLog.ts, gets no synthesized correlation, and so its
  // trace fallback is already null — the dispatcher drops a keyless pi record
  // either way (codingAgentLogFactsDispatch.subscriber.ts:113-119). This makes
  // that hold on purpose rather than by accident, and keeps holding if pi ever
  // gains a wire trace id.
  logsRequireSessionKey: true,
};
