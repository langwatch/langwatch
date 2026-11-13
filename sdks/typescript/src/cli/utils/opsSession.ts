/**
 * Local state of the ops agent (ADR-202): the requester key, pending PKCE verifiers and the live
 * staff access session. Every file is 0600 in a 0700 directory, written atomically. Never `.env`.
 * @see modules/staff-access/specs/staff-access-cli.feature
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { type Command, Option } from "commander";
import { z } from "zod";

import { normalizeEndpoint } from "@/internal/endpoint";

import { commandPath, leafCommands } from "./projectOption";

/** Environment variable that relocates the session file. */
export const OPS_SESSION_ENV = "LANGWATCH_OPS_SESSION";
/** Environment variable the ops commands read the requester key from when setup stored none. */
export const OPS_REQUESTER_KEY_ENV = "LANGWATCH_OPS_REQUESTER_KEY";

/** The flag a non-ops command takes to run on the ops session instead of the caller's own key. */
export const OPS_SESSION_FLAG = "--ops-session";

/** Whether a command path is one of `langwatch ops *`, which always works on the ops session. */
export const isOpsCommandPath = (path: string): boolean =>
  path === "ops" || path.startsWith("ops ");

/**
 * Declare the hidden `--ops-session` on every leaf outside `ops` (and outside the pass-through
 * wrappers, which forward unknown flags); called once at the end of `buildProgram`.
 */
export const applyOpsSessionOption = (program: Command): void => {
  for (const leaf of leafCommands(program)) {
    if (isOpsCommandPath(commandPath(leaf))) continue;
    const allowsUnknown =
      (leaf as unknown as { _allowUnknownOption?: boolean })._allowUnknownOption === true;
    if (allowsUnknown) continue;
    leaf.addOption(
      new Option(
        OPS_SESSION_FLAG,
        "Run on the live ops session (staff access) instead of your own credentials",
      ).hideHelp(),
    );
  }
};

/** Whether the command about to run may act on the ops session: an `ops` command, or the flag. */
export const commandUsesOpsSession = (command: Command): boolean =>
  isOpsCommandPath(commandPath(command)) ||
  command.opts<{ opsSession?: unknown }>().opsSession === true;

/** The CLI config's directory, resolved like `configPath` (and the daemon's eligibility check). */
const configDir = (): string =>
  path.dirname(
    process.env.LANGWATCH_CLI_CONFIG ?? path.join(os.homedir(), ".langwatch", "config.json"),
  );

/** `<config dir>/ops-agent.json`: the requester key. */
export const opsAgentPath = (): string => path.join(configDir(), "ops-agent.json");

/** `<config dir>/ops-session.json`, or `LANGWATCH_OPS_SESSION`. */
export const opsSessionPath = (): string => {
  const override = process.env[OPS_SESSION_ENV]?.trim();
  return override ? path.resolve(override) : path.join(configDir(), "ops-session.json");
};

/** Pending verifiers live beside the session file they will become. */
export const opsPendingPath = (): string =>
  path.join(path.dirname(opsSessionPath()), "ops-pending.json");

/** Write JSON atomically with mode 0600, creating the directory 0700. */
export const writePrivateJson = ({ file, value }: { file: string; value: unknown }): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
};

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Failed to read ${file}: ${(error as Error).message}`);
  }
};

const removeFile = (file: string): boolean => {
  try {
    fs.unlinkSync(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

const opsAgentSchema = z.object({ requesterKey: z.string().min(1) });

export const saveRequesterKey = ({ requesterKey }: { requesterKey: string }): string => {
  const file = opsAgentPath();
  writePrivateJson({ file, value: { requesterKey } });
  return file;
};

export const loadRequesterKey = (): string | undefined => {
  const parsed = opsAgentSchema.safeParse(readJson(opsAgentPath()));
  return parsed.success ? parsed.data.requesterKey.trim() : undefined;
};

export const opsProjectSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});
export type OpsProject = z.infer<typeof opsProjectSchema>;

export const opsSessionSchema = z.object({
  version: z.literal(1),
  endpoint: z.string(),
  requestId: z.string(),
  apiKey: z.string().optional(),
  opsToken: z.string().optional(),
  organizationId: z.string().optional(),
  projects: z.array(opsProjectSchema),
  defaultProjectId: z.string().optional(),
  scopes: z.array(z.string()),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type OpsSession = z.infer<typeof opsSessionSchema>;

export const saveOpsSession = (session: OpsSession): string => {
  const file = opsSessionPath();
  writePrivateJson({ file, value: session });
  return file;
};

export const removeOpsSession = (): boolean => removeFile(opsSessionPath());

/** What the session file holds right now: nothing, a live session, or one past its expiry. */
export type OpsSessionState =
  | { kind: "none" }
  | { kind: "live"; session: OpsSession; file: string }
  | { kind: "expired"; session: OpsSession; file: string }
  | { kind: "invalid"; file: string };

export const readOpsSession = ({ now = Date.now() }: { now?: number } = {}): OpsSessionState => {
  const file = opsSessionPath();
  let raw: unknown;
  try {
    raw = readJson(file);
  } catch {
    return { kind: "invalid", file };
  }
  if (raw === undefined) return { kind: "none" };
  const parsed = opsSessionSchema.safeParse(raw);
  if (!parsed.success) return { kind: "invalid", file };
  const expiresAtMs = Date.parse(parsed.data.expiresAt);
  const isExpired = !Number.isFinite(expiresAtMs) || expiresAtMs <= now;
  return isExpired
    ? { kind: "expired", session: parsed.data, file }
    : { kind: "live", session: parsed.data, file };
};

/** Whether two endpoints are one address (scheme, host, port). */
export const isSameOrigin = ({ a, b }: { a: string; b: string }): boolean => {
  try {
    return new URL(normalizeEndpoint(a)).origin === new URL(normalizeEndpoint(b)).origin;
  } catch {
    return false;
  }
};

/** The session project a selector names (id or slug), or the session default. */
export const pickSessionProject = ({
  session,
  selector,
}: {
  session: OpsSession;
  selector?: string;
}): OpsProject | undefined => {
  const wanted = selector?.trim();
  if (!wanted) {
    return (
      session.projects.find((project) => project.id === session.defaultProjectId) ??
      session.projects[0]
    );
  }
  return session.projects.find((project) => project.id === wanted || project.slug === wanted);
};

const pendingSchema = z.record(
  z.string(),
  z.object({
    endpoint: z.string(),
    codeVerifier: z.string(),
    approvalUrl: z.string(),
    expiresAt: z.string(),
    project: z.string().optional(),
  }),
);
export type PendingRequest = z.infer<typeof pendingSchema>[string];

const loadPending = ({ now }: { now: number }): Record<string, PendingRequest> => {
  const parsed = pendingSchema.safeParse(readJson(opsPendingPath()));
  if (!parsed.success) return {};
  return Object.fromEntries(
    Object.entries(parsed.data).filter(([, entry]) => Date.parse(entry.expiresAt) > now),
  );
};

const savePending = (entries: Record<string, PendingRequest>): void => {
  if (Object.keys(entries).length === 0) {
    removeFile(opsPendingPath());
    return;
  }
  writePrivateJson({ file: opsPendingPath(), value: entries });
};

export const storePendingRequest = ({
  requestId,
  pending,
  now = Date.now(),
}: {
  requestId: string;
  pending: PendingRequest;
  now?: number;
}): void => {
  savePending({ ...loadPending({ now }), [requestId]: pending });
};

export const takePendingRequest = ({
  requestId,
  now = Date.now(),
}: {
  requestId: string;
  now?: number;
}): PendingRequest | undefined => loadPending({ now })[requestId];

export const forgetPendingRequest = ({
  requestId,
  now = Date.now(),
}: {
  requestId: string;
  now?: number;
}): void => {
  const entries = loadPending({ now });
  delete entries[requestId];
  savePending(entries);
};

/** RFC 7636 PKCE pair: a 32-byte base64url verifier and its S256 challenge. */
export const createPkcePair = (): { codeVerifier: string; codeChallenge: string } => {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  return { codeVerifier, codeChallenge: pkceChallengeFor({ codeVerifier }) };
};

export const pkceChallengeFor = ({ codeVerifier }: { codeVerifier: string }): string =>
  crypto.createHash("sha256").update(codeVerifier).digest("base64url");

/** Host name plus OS user, as the approval page shows it. */
export const describeMachine = (): string => {
  let user = "unknown";
  try {
    user = os.userInfo().username;
  } catch {
    user = process.env.USER ?? "unknown";
  }
  return `${os.hostname()} (${user})`.slice(0, 200);
};
