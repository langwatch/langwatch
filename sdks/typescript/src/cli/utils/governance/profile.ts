/**
 * Named credential profiles, modelled on the AWS CLI: a `--profile` flag, a
 * `LANGWATCH_PROFILE` environment variable, and a default.
 *
 * The entire system is this module plus one line in `configPath()`. Every
 * command already reads credentials through that function, so making it
 * profile-aware gives the whole CLI profiles without a single command
 * learning anything about them.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const DEFAULT_PROFILE = "default";

/**
 * Profile names become filenames, so they are validated rather than
 * sanitised: quietly rewriting `../prod` into something else would write
 * credentials somewhere the user did not ask for, which is worse than an
 * error. Leading dot is out so a name can never produce a hidden file or
 * `.`/`..`.
 */
const VALID_PROFILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_PROFILE_LENGTH = 64;

export class InvalidProfileNameError extends Error {
  constructor(name: string) {
    super(
      `Invalid profile name ${JSON.stringify(name)}. ` +
        `Use letters, digits, dots, dashes or underscores, starting with a letter or digit.`,
    );
    this.name = "InvalidProfileNameError";
  }
}

export function assertValidProfileName(name: string): void {
  if (
    name.length === 0 ||
    name.length > MAX_PROFILE_LENGTH ||
    !VALID_PROFILE.test(name)
  ) {
    throw new InvalidProfileNameError(name);
  }
}

/**
 * Which profile this process is using. The `--profile` flag reaches here by
 * setting the environment variable in a pre-action hook, so this stays a pure
 * read and nothing has to be threaded through every command signature.
 */
export function resolveProfileName(explicit?: string): string {
  const name = explicit ?? process.env.LANGWATCH_PROFILE ?? DEFAULT_PROFILE;
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === DEFAULT_PROFILE) return DEFAULT_PROFILE;
  assertValidProfileName(trimmed);
  return trimmed;
}

export function langwatchHome(): string {
  return path.join(os.homedir(), ".langwatch");
}

export function profilesDir(): string {
  return path.join(langwatchHome(), "profiles");
}

/**
 * Where a profile's credentials live.
 *
 * The default profile stays at `~/.langwatch/config.json` rather than moving
 * to `profiles/default.json`: every existing install already has that file,
 * and a migration whose failure mode is "your credentials disappeared" is not
 * worth the tidiness.
 */
export function profileConfigPath(name: string): string {
  if (name === DEFAULT_PROFILE) {
    return path.join(langwatchHome(), "config.json");
  }
  assertValidProfileName(name);
  return path.join(profilesDir(), `${name}.json`);
}

/**
 * The profile a `--solo` run uses, derived from the directory it runs in.
 *
 * Per directory, not per invocation: a fresh account every time would burn the
 * provisioning rate limit within minutes and leave a trail of abandoned
 * workspaces. Per directory means two agents in two checkouts are two
 * identities, and re-running in either one picks its own back up.
 *
 * The hash carries the identity; the readable prefix is only so `profile list`
 * is legible to a human.
 */
export function soloProfileName(cwd: string): string {
  const digest = shortHash(cwd);
  const base = path
    .basename(cwd)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return base ? `solo-${base}-${digest}` : `solo-${digest}`;
}

/**
 * FNV-1a, deliberately not `node:crypto`.
 *
 * This module sits on the CLI's boot path — `configPath()` needs it on every
 * command — and the ~30ms cold start depends on that graph pulling in nothing
 * heavy. The digest only has to distinguish one directory from another in a
 * filename; nothing security-relevant rests on it, and a collision costs two
 * directories a shared profile rather than anything worse.
 */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function isSoloProfile(name: string): boolean {
  return name.startsWith("solo-");
}

/**
 * Every profile on this machine, default first. Used by `profile list`; never
 * reads the files, so it cannot leak a credential into a listing.
 */
export function listProfileNames(): string[] {
  const names: string[] = [];
  if (fs.existsSync(profileConfigPath(DEFAULT_PROFILE))) {
    names.push(DEFAULT_PROFILE);
  }
  try {
    const entries = fs.readdirSync(profilesDir());
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      names.push(entry.slice(0, -".json".length));
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return names;
}
