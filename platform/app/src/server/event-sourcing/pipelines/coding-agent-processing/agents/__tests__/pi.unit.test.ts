/**
 * pi's identity, on the two axes ADR-132's Gates table names separately: the
 * match rule in isolation, and pi's position in the ordered registry. They are
 * tested apart on purpose — the rule is what stops pi claiming another agent's
 * record, the position is the belt to that braces, and a reviewer who reorders
 * the registry has to see a failure that says so.
 *
 * See specs/coding-agent/pi-session-capture.feature.
 */

import { describe, expect, it } from "vitest";
import { detectCodingAgent } from "../../services/coding-agent-normalization";
import { type CodingAgentSignal, signalSays } from "../_types";
import { CODING_AGENT_REGISTRY } from "../index";
import { piAgent } from "../pi";

const signal = (parts: Partial<CodingAgentSignal>): CodingAgentSignal => ({
  name: "",
  scope: "",
  service: "",
  ...parts,
});

/** A Claude Code record as it arrives on the wire, pre-lowercased. */
const CLAUDE_CODE_SIGNAL = signal({
  name: "claude_code.user_prompt",
  scope: "com.anthropic.claude_code.events",
  service: "claude-code",
});

/** A Copilot CLI record, same. */
const COPILOT_SIGNAL = signal({
  name: "github.copilot.session_start",
  scope: "github.copilot",
  service: "copilot-cli",
});

describe("piAgent", () => {
  describe("given a signal belonging to another agent", () => {
    describe("when pi's match rule is asked on its own, registry order removed", () => {
      /** @scenario "pi's match rule does not fire on a scope or service that merely contains its letters" */
      it("claims neither the anthropic-scoped nor the copilot-serviced signal", () => {
        // Guard the guard: these two signals only test anything because the
        // naive rule DOES fire on them. If `signalSays` ever stops being
        // substring-based, this assertion fails and tells us the fixtures
        // have gone toothless rather than letting the test pass vacuously.
        expect(signalSays(CLAUDE_CODE_SIGNAL, "pi")).toBe(true);
        expect(signalSays(COPILOT_SIGNAL, "pi")).toBe(true);

        expect(piAgent.matches(CLAUDE_CODE_SIGNAL)).toBe(false);
        expect(piAgent.matches(COPILOT_SIGNAL)).toBe(false);
      });
    });

    describe("when the agent is identified through the real registry", () => {
      /** @scenario "An existing agent's session is not relabelled as pi" */
      it("identifies each record as its own agent", () => {
        // These two assertions alone were VACUOUS and an adversarial pass
        // proved it: with piAgent deleted from the registry outright, they
        // still passed, because claude_code and copilot identify themselves
        // perfectly well when pi does not exist. Even a matcher of
        // `() => true` left them green, since first-match-wins never reaches
        // a seventh entry for signals a earlier one already claims. They were
        // a test of the OTHER agents wearing a pi title.
        //
        // So the registry's shape is asserted here too, in the same test that
        // carries the scenario. Now pi being absent fails it, and pi being
        // moved ahead of an established agent fails it, which is the only
        // arrangement in which the outcomes below could ever be wrong.
        expect(CODING_AGENT_REGISTRY).toContain(piAgent);
        expect(CODING_AGENT_REGISTRY.indexOf(piAgent)).toBe(
          CODING_AGENT_REGISTRY.length - 1,
        );

        expect(
          detectCodingAgent({
            recordName: CLAUDE_CODE_SIGNAL.name,
            scopeName: CLAUDE_CODE_SIGNAL.scope,
            serviceName: CLAUDE_CODE_SIGNAL.service,
          }),
        ).toBe("claude_code");

        expect(
          detectCodingAgent({
            recordName: COPILOT_SIGNAL.name,
            scopeName: COPILOT_SIGNAL.scope,
            serviceName: COPILOT_SIGNAL.service,
          }),
        ).toBe("copilot");
      });
    });
  });

  // ADR-132's Gates table wants the registry POSITION to fail on its own,
  // separately from the match rule. It stays a separate test for that reason —
  // but it is annotated, not left bare. An unannotated test is invisible to
  // the parity gate, which walks scenarios to tests and never the other way,
  // so the guard the ADR calls load-bearing was enforced by nothing the gate
  // could see: the reorder it exists to catch would have shown a green gate.
  describe("given the ordered registry", () => {
    describe("when pi's position is read", () => {
      /** @scenario "An existing agent's session is not relabelled as pi" */
      it("keeps pi as the last entry, so an established agent always wins a tie", () => {
        expect(CODING_AGENT_REGISTRY.at(-1)).toBe(piAgent);
      });
    });
  });
});
