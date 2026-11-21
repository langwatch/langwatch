/**
 * Whether the terminal's login is the person who asked Langy. The terminal lists only its
 * login's own requests, so a login that is someone else's would wait for ever in silence.
 * @see specs/typescript-sdk/cli-langy-share-control.feature
 */

import chalk from "chalk";
import prompts from "prompts";

import { loadConfig } from "../../utils/governance/config";

/** How long the terminal waits with nothing before it names its login and how to switch. */
export const NOTHING_YET_AFTER_MS = 30_000;

/** Who the login on this machine is, as the login recorded it. */
export type SignedInPerson = { email?: string; name?: string; organization?: string };

/** The value without surrounding spaces, or undefined when nothing is left. */
export const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
};

export function signedInPerson(): SignedInPerson {
  try {
    const cfg = loadConfig();
    const email = nonEmpty(cfg.user?.email);
    const name = nonEmpty(cfg.user?.name);
    const organization = nonEmpty(cfg.organization?.name);
    return {
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
      ...(organization ? { organization } : {}),
    };
  } catch {
    return {};
  }
}

const sameEmail = ({ left, right }: { left: string; right: string }): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

/** What to run to switch, for a terminal that cannot ask. */
const switchHint = (askedBy: string): string =>
  `To share as ${askedBy}, stop this command (Ctrl+C), run \`langwatch login --device\` and approve as ${askedBy}, then run this command again.`;

/** The line printed after a while with no request: who the login is, and how to switch. */
export function nothingYetMessage({ person }: { person: SignedInPerson }): string[] {
  const who = person.email ?? person.name ?? "this login";
  const login = `${who}${person.organization ? ` at ${person.organization}` : ""}`;
  return [
    `No Langy request has reached ${login} yet.`,
    "If you asked Langy from another account, stop this command (Ctrl+C), run `langwatch login --device` and approve as that account, then run this command again.",
  ];
}

/**
 * `"switched"`: a sign-in replaced the login on this machine, whoever it landed on, so the caller
 * reloads its credentials. The others leave the login as it was.
 */
export type AccountOutcome = "same" | "switched" | "kept" | "unknown";

/**
 * Compares the login with `--as`. On a mismatch it says so and, on a terminal, offers the device
 * login there and then.
 */
export async function matchAskerAccount({
  askedBy,
  signIn,
  person = signedInPerson,
  ask = prompts,
  interactive = process.stdin.isTTY === true,
  print = (line: string) => console.log(line),
}: {
  askedBy: string | undefined;
  /** Runs the device login; it replaces the login on this machine. */
  signIn: () => Promise<void>;
  person?: () => SignedInPerson;
  ask?: typeof prompts;
  interactive?: boolean;
  print?: (line: string) => void;
}): Promise<AccountOutcome> {
  const asker = nonEmpty(askedBy);
  if (!asker) return "same";
  const current = person().email;
  if (!current) return "unknown";
  if (sameEmail({ left: current, right: asker })) return "same";

  print("");
  print(chalk.yellow(`Signed in as ${current}, the request came from ${asker}.`));
  if (!interactive) {
    print(chalk.gray(switchHint(asker)));
    return "kept";
  }
  const answer = (await ask({
    type: "confirm",
    name: "switch",
    message: `Sign in as ${asker}?`,
    initial: true,
  })) as { switch?: boolean };
  if (answer.switch !== true) {
    print(
      chalk.gray(
        `Staying signed in as ${current}. Requests made by ${asker} do not reach this terminal.`,
      ),
    );
    return "kept";
  }

  print(chalk.gray(`Approve the sign-in in your browser as ${asker}.`));
  try {
    await signIn();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // The flow can save the new login and then fail on a later step; name what is saved.
    const saved = person().email ?? current;
    if (sameEmail({ left: saved, right: current })) {
      print(
        chalk.yellow(`Could not sign in as ${asker} (${reason}). Staying signed in as ${current}.`),
      );
      return "kept";
    }
    print(
      chalk.yellow(
        `Could not finish signing in as ${asker} (${reason}). Now signed in as ${saved}.`,
      ),
    );
    return "switched";
  }
  const after = person().email ?? current;
  if (sameEmail({ left: after, right: asker })) return "switched";
  const changed = !sameEmail({ left: after, right: current });
  print(
    chalk.yellow(`${changed ? "Now signed in as" : "Still signed in as"} ${after}, not ${asker}.`),
  );
  print(chalk.gray(switchHint(asker)));
  return "switched";
}
