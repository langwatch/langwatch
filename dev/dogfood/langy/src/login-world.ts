/**
 * World C1 (issue 8770): a coding-agent cost question leads Langy to `langwatch whoami`, which in
 * its sandbox answers "Not logged in". Langy must not pass that on as advice to the user. Langy's
 * tool results have no public read, so the facts are what its replies say.
 */
import { LOGIN_WORLD } from "./world-names.ts";

export interface LoginWorldState {
  world: typeof LOGIN_WORLD;
}

export interface LoginFacts {
  /** The login or no-tools advice phrases in Langy's reply this turn. */
  login_advice: string[];
}

const LOGIN_ADVICE: readonly RegExp[] = [
  /not logged in/i,
  /langwatch login/i,
  /\b(sign|log)\s?(in|on)\b/i,
  /\bauthenticat(e|ion)\b/i,
  /(no|don't have|do not have|without) (access to )?(a |the )?(cli|command[- ]line|tools?)\b/i,
];

export function isLoginWorldState(state: unknown): state is LoginWorldState {
  return (
    typeof state === "object" && state !== null && (state as LoginWorldState).world === LOGIN_WORLD
  );
}

/** Every login or no-tools phrase a reply holds, as written. */
export function loginAdviceIn({ text }: { text: string }): string[] {
  return LOGIN_ADVICE.flatMap((pattern) => {
    const match = pattern.exec(text);
    return match ? [match[0]] : [];
  });
}

export function setupLoginWorld(): LoginWorldState {
  return { world: LOGIN_WORLD };
}

/** What every turn's reply held, and what the connector cannot see. */
export function teardownLoginWorld({ state }: { state: Record<string, unknown> }) {
  const perTurn = (state.facts_after_turn ?? {}) as Record<string, LoginFacts>;
  const advice = Object.values(perTurn).flatMap((facts) => facts.login_advice);
  return {
    final_facts: {
      login_advice_any_turn: [...new Set(advice)],
      reproduced_8770: advice.length > 0,
    },
    deleted: {},
    left_behind: {
      tool_results:
        "not read: no public API returns a Langy conversation's tool calls, so a 'Not logged in' tool result that Langy did not repeat is invisible here",
    },
  };
}
