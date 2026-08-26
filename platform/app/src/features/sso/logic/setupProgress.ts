/**
 * Where the journey actually is, as five answers rather than five ticks.
 *
 * THE COMPLAINT THIS ANSWERS. A screen that only knows "done" and "not done"
 * shows a reader four identical cards and leaves them to work out which one
 * is theirs, whether the last one will even accept a press, and — when it
 * refuses — why. That is what "it gets stuck halfway and nothing tells you
 * how or why" means in practice: the information existed, and no step was
 * rendering it.
 *
 * Three separable facts per step: is it finished, can it be done at all yet,
 * and is it the one to do now. Only the last is a matter of taste; the other
 * two are the aggregate's, and this reads them off `goLive` rather than
 * inventing a second opinion.
 *
 * Framework-free, so the five answers are pinned by a test that renders
 * nothing.
 */

/**
 * How one step is drawn. Lives here rather than on the component, because
 * the decision is this module's and the component only renders it.
 *
 *   done      finished, and it stays finished
 *   current   THIS is the one to do now
 *   blocked   it cannot be done yet, and the note says what it waits for
 *   todo      later, and unremarkable
 */
export type SetupStepState = "done" | "current" | "blocked" | "todo";

export interface SetupProgress {
  provider: SetupStepState;
  domain: SetupStepState;
  testSignIn: SetupStepState;
  breakGlass: SetupStepState;
  /** Whether somebody has said who the connection admits (ADR-117 §3). */
  arrivals: SetupStepState;
  goLive: SetupStepState;
  /** Why turning it on is not available yet, or null when it is. */
  goLiveBlockedBecause: string | null;
}

export function setupProgressFor({
  domainProved,
  testSignInDone,
  breakGlassInPlace,
  arrivalsDecided,
  activated,
}: {
  domainProved: boolean;
  testSignInDone: boolean;
  breakGlassInPlace: boolean;
  arrivalsDecided: boolean;
  activated: boolean;
}): SetupProgress {
  // Registering happened, or none of this would be on screen.
  const provider: SetupStepState = "done";

  // Turning it on is the only step with prerequisites, and the aggregate
  // refuses it until all three hold. Naming them here is what turns a
  // button that does nothing into a sentence somebody can act on.
  const outstanding = [
    domainProved ? null : "a proved domain",
    testSignInDone ? null : "a sign-in that worked",
    breakGlassInPlace ? null : "somebody who can still get in without it",
    // The fourth, and the only one that is a DECISION rather than a thing
    // that had to happen. Turning a connection on without saying what it
    // does with somebody it has never seen is choosing by not choosing.
    arrivalsDecided ? null : "a decision about who it lets in",
  ].filter((entry): entry is string => entry !== null);

  const goLiveBlockedBecause =
    activated || outstanding.length === 0
      ? null
      : `Turning it on needs ${listed(outstanding)}. Finish ${outstanding.length === 1 ? "that step" : "those steps"} above and this opens up.`;

  // The one to do now is the first unfinished step that CAN be done. Every
  // step but the last is always available: a test sign-in names the
  // connection directly, so it works before a domain is proved, and break
  // glass is somebody an administrator names whenever they like.
  const order: Array<[keyof SetupProgress, boolean]> = [
    ["domain", domainProved],
    ["testSignIn", testSignInDone],
    ["breakGlass", breakGlassInPlace],
    ["arrivals", arrivalsDecided],
  ];
  const current = order.find(([, done]) => !done)?.[0] ?? null;

  const stateFor = (key: keyof SetupProgress, done: boolean): SetupStepState =>
    done ? "done" : current === key ? "current" : "todo";

  return {
    provider,
    domain: stateFor("domain", domainProved),
    testSignIn: stateFor("testSignIn", testSignInDone),
    breakGlass: stateFor("breakGlass", breakGlassInPlace),
    arrivals: stateFor("arrivals", arrivalsDecided),
    goLive: activated
      ? "done"
      : goLiveBlockedBecause !== null
        ? "blocked"
        : "current",
    goLiveBlockedBecause,
  };
}

/** "a and b", "a, b and c" — the way a person writes a short list. */
function listed(entries: string[]): string {
  if (entries.length <= 1) return entries[0] ?? "";
  return `${entries.slice(0, -1).join(", ")} and ${entries[entries.length - 1]}`;
}
