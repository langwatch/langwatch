/**
 * The one-line identity notice: which credential a command is about to run as, said once,
 * on stderr, and then kept quiet.
 * Spec: specs/ai-governance/cli-onboarding/me-credentials.feature
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { normalizeEndpoint } from "../../internal/endpoint";
import { configPath } from "./governance/config";

/** How long one showing of the notice keeps later ones quiet. */
export const NOTICE_SUPPRESSION_MS = 30 * 60 * 1000;

/** Entries older than this are pruned so the state file cannot grow forever. */
const STATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Ceiling for the one-off project-name lookup; a slow platform must not
 * make every CLI command feel slow. */
const NAME_FETCH_TIMEOUT_MS = 1_500;

export type NoticeMode = "device" | "device-login-key" | "api-key";

interface NoticeState {
  /** sha256(mode:credential) -> epoch ms the notice was last shown. */
  shownAt?: Record<string, number>;
  /** sha256(credential) -> project name the credential belongs to. */
  projectNames?: Record<string, string>;
}

export function noticeStatePath(): string {
  return path.join(path.dirname(configPath()), "notice-state.json");
}

/**
 * Local dedup fingerprint, NOT a password verifier. The state file maps a fingerprint of
 * the credential to "when was the notice last shown" / "which project name did it resolve
 * to", purely so the raw key never has to be written to disk twice.
 */
function hashCredential(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function loadState(): NoticeState {
  try {
    return JSON.parse(fs.readFileSync(noticeStatePath(), "utf8")) as NoticeState;
  } catch {
    return {};
  }
}

function saveState(state: NoticeState): void {
  const p = noticeStatePath();
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(tmp, p);
}

function pruneState(state: NoticeState, now: number): void {
  for (const [key, at] of Object.entries(state.shownAt ?? {})) {
    if (now - at > STATE_RETENTION_MS) delete state.shownAt![key];
  }
}

/**
 * Seed the credential -> project-name cache. Called from the login flow,
 * where the server response already names the project, so the very first
 * api-key notice does not need a network round trip.
 */
export function rememberProjectName(apiKey: string, name: string): void {
  try {
    const state = loadState();
    state.projectNames = {
      ...state.projectNames,
      [hashCredential(apiKey)]: name,
    };
    saveState(state);
  } catch {
    // Cache seeding is best-effort.
  }
}

async function fetchProjectName(
  apiKey: string,
  endpoint: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  try {
    const res = await fetchImpl(`${normalizeEndpoint(endpoint)}/api/v1/me/project`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(NAME_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { name?: string };
    return typeof body.name === "string" && body.name.trim() !== "" ? body.name : undefined;
  } catch {
    return undefined;
  }
}

function renderLine(mode: NoticeMode, projectName: string | undefined): string {
  if (mode === "device") {
    return "Using your personal project (device login). Read another project: langwatch login --project";
  }
  if (mode === "device-login-key") {
    return "Using your login key on your personal project. Read another project: add --project <id|slug>";
  }
  if (projectName) {
    return `Using API key for project "${projectName}". Switch: langwatch login --project | --device`;
  }
  return "Using API key from LANGWATCH_API_KEY. Switch: langwatch login --project | --device";
}

/**
 * Print the identity notice for this (credential, mode) pair unless it was
 * already shown within the suppression window. Silent on any failure.
 */
export async function maybePrintIdentityNotice({
  mode,
  apiKey,
  endpoint,
  fetchImpl = fetch,
}: {
  mode: NoticeMode;
  apiKey: string;
  endpoint: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  try {
    const now = Date.now();
    const state = loadState();
    const suppressionKey = hashCredential(`${mode}:${apiKey}`);
    const lastShown = state.shownAt?.[suppressionKey];
    if (lastShown !== undefined && now - lastShown < NOTICE_SUPPRESSION_MS) {
      return;
    }

    let projectName: string | undefined;
    if (mode === "api-key") {
      const nameKey = hashCredential(apiKey);
      projectName = state.projectNames?.[nameKey];
      if (!projectName) {
        projectName = await fetchProjectName(apiKey, endpoint, fetchImpl);
        if (projectName) {
          state.projectNames = { ...state.projectNames, [nameKey]: projectName };
        }
      }
    }

    // Record the showing BEFORE printing: a concurrent command racing this
    // one at worst double-prints, but a crash mid-print must not turn the
    // notice into a nag on every following command.
    state.shownAt = { ...state.shownAt, [suppressionKey]: now };
    pruneState(state, now);
    saveState(state);

    const line = renderLine(mode, projectName);
    console.error(process.stderr.isTTY ? chalk.yellow(line) : line);
  } catch {
    // The notice must never break, slow-fail, or exit a command.
  }
}
