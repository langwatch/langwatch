/**
 * Security boundary: each socket is keyed by sha256(endpoint, apiKey, uid), so
 * a daemon holds only one identity's credentials. Auth is re-read from
 * config.json per request rather than cached, so a logout/login takes effect at once.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";

/**
 * Unix domain socket paths are capped by sockaddr_un.sun_path: 104 bytes on
 * macOS/BSD, 108 on Linux. Exceeding it fails at bind() with EINVAL, which we
 * would rather turn into a clean "no daemon" fallback than a crash.
 */
const MAX_SOCKET_PATH_BYTES = 100;

/**
 * What `resolveIdentity` appends to the base directory: a separator, 16 hex
 * characters of fingerprint and `.sock`. Known here so `daemonSocketDir` can
 * tell whether a candidate base leaves room for the socket at all.
 */
const SOCKET_FILE_BYTES = 1 + 16 + ".sock".length;

/**
 * A daemon binds a pid-scoped staging name, up to 3 bytes longer than the
 * shared path (a 7-digit pid replacing ".sock"). Budgeting only the shared
 * path underestimates and lets a "fitting" directory still fail at `bind()`.
 */
export const MAX_STAGING_OVERHEAD_BYTES = 3;

export interface DaemonIdentity {
  /** Full sha256 hex of the identity tuple. Presented in the handshake. */
  fingerprint: string;
  /** Absolute path to this identity's socket. */
  socketPath: string;
  /** Directory holding the socket. Created 0700 on demand. */
  socketDir: string;
  /** The resolved control-plane URL this identity points at. */
  endpoint: string;
}

/**
 * Windows needs a named pipe with no 0600/0700 equivalent -- its default
 * ACL is a weaker posture, so rather than ship an unverified IPC surface,
 * the daemon is disabled on win32; every command runs in-process.
 */
export function isDaemonSupported(): boolean {
  return process.platform !== "win32";
}

/**
 * Base directory for daemon sockets: `$XDG_RUNTIME_DIR`, else
 * `$HOME/.langwatch/run`. `os.tmpdir()` is a last resort — on Linux, `/tmp` is
 * world-writable and squattable; `$HOME` closes that (see `inspectSocketTrust`).
 */
export function daemonSocketDir(): string {
  const override = process.env.LANGWATCH_DAEMON_DIR;
  if (override) return override;

  // The uid is in the directory name so two users on one box never contend for
  // the same directory (whose 0700 mode would make the loser fail to enter).
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const leaf = `langwatch-${uid}`;

  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir && runtimeDir.trim() !== "") return path.join(runtimeDir, leaf);

  const home = os.homedir();
  if (home !== "") {
    const underHome = path.join(home, ".langwatch", "run", leaf);
    // A long $HOME pushes the socket past sockaddr_un and disables the
    // daemon. The temp dir is shorter, validated on every connect -- some
    // daemon beats none. Budgeted against the STAGING name, the longer of
    // the two: a directory fitting the shared path but not staging can't
    // start a daemon.
    if (
      Buffer.byteLength(underHome, "utf8") + SOCKET_FILE_BYTES + MAX_STAGING_OVERHEAD_BYTES <=
      MAX_SOCKET_PATH_BYTES
    ) {
      return underHome;
    }
  }
  return path.join(os.tmpdir(), leaf);
}

/**
 * Resolves the identity of the CURRENT invocation, via the CLI's single
 * endpoint resolver so client and daemon never disagree about "the
 * endpoint" -- a drift would key two invocations to different daemons.
 */
export function resolveIdentity(env: NodeJS.ProcessEnv = process.env): DaemonIdentity {
  const endpoint = resolveControlPlaneUrl();
  const apiKey = env.LANGWATCH_API_KEY ?? "";
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  // The config path participates too: `LANGWATCH_CLI_CONFIG` swaps the whole
  // persisted-credential file, which is a different identity even when the
  // endpoint and API key happen to match (this is also what keeps tests from
  // colliding with a developer's real daemon).
  const configPath = env.LANGWATCH_CLI_CONFIG ?? "";

  // API keys are high-entropy identity material, not user passwords. This
  // digest is a deterministic, non-reversible namespace key shared by the CLI
  // and daemon; a password KDF would add latency without improving that model.
  const hasher = crypto.createHash("sha256");
  // lgtm[js/insufficient-password-hash]
  const fingerprint = hasher.update(`${endpoint}\0${apiKey}\0${uid}\0${configPath}`).digest("hex");

  const socketDir = daemonSocketDir();
  // 16 hex chars = 64 bits. A collision needs ~2^32 distinct identities on one
  // machine before it is even worth thinking about, and the handshake's
  // full-fingerprint check makes a collision a clean refusal, not a leak.
  const socketPath = path.join(socketDir, `${fingerprint.slice(0, 16)}.sock`);

  return { fingerprint, socketPath, socketDir, endpoint };
}

/**
 * Build identity is version PLUS the entrypoint's size and mtime, not semver
 * alone — a same-version rebuild or reinstall would otherwise let a daemon
 * keep serving OLD behaviour to a NEW client silently; any rebuild evicts it.
 */
export function resolveBuildId(cliVersion: string, cliPath: string): string {
  try {
    const stat = fs.statSync(cliPath);
    return `${cliVersion}+${stat.size}-${Math.trunc(stat.mtimeMs)}`;
  } catch {
    // No readable entrypoint (an odd packaging, or argv[1] is not a file).
    // Fall back to the version alone: weaker, but never wrong in a way that
    // breaks a command.
    return cliVersion;
  }
}

/**
 * The daemon skips dotenv on boot so a stray `~/.env` cannot give it different
 * identity inputs than its spawning client; pinning the three vars here is the
 * second layer of that defence (dotenv never overwrites an already-set var).
 */
export function identityEnv(
  env: NodeJS.ProcessEnv,
  identity: DaemonIdentity,
): Record<string, string> {
  return {
    LANGWATCH_ENDPOINT: identity.endpoint,
    LANGWATCH_API_KEY: env.LANGWATCH_API_KEY ?? "",
    LANGWATCH_CLI_CONFIG: env.LANGWATCH_CLI_CONFIG ?? "",
  };
}

/** Whether THIS path — exactly as written — fits inside sockaddr_un. */
export function isSocketPathUsable(socketPath: string): boolean {
  return Buffer.byteLength(socketPath, "utf8") <= MAX_SOCKET_PATH_BYTES;
}

/**
 * Whether a daemon could actually be RUN on this shared path — stricter than
 * `isSocketPathUsable`, because a daemon also binds a pid-scoped staging name
 * beside the shared one, which must fit too.
 */
export function isDaemonSocketPathUsable(socketPath: string): boolean {
  return (
    Buffer.byteLength(socketPath, "utf8") + MAX_STAGING_OVERHEAD_BYTES <= MAX_SOCKET_PATH_BYTES
  );
}

/**
 * Why a socket must not be connected to; `null` means safe. This is the
 * CLIENT-side half of the trust model — without it a squatted socket looks
 * like ours, and the client pipelines `exec` (args, cwd, env, API key) blind.
 */
export type SocketTrustProblem =
  | "socket-dir-missing"
  | "socket-dir-not-a-directory"
  | "socket-dir-foreign-owner"
  | "socket-dir-loose-mode"
  | "socket-missing"
  | "socket-not-a-socket"
  | "socket-foreign-owner"
  | "socket-loose-mode";

/** No group or other bits at all — the 0600/0700 half of the trust model. */
function hasLooseMode(mode: number): boolean {
  return (mode & 0o077) !== 0;
}

/**
 * Socket and parent must be owned by us with no group/other bits (`lstat`, so
 * a symlink can't stand in for either). Failures degrade to in-process rather
 * than leak — including an unchecked ancestor rename under a group-writable `$HOME`.
 */
export function inspectSocketTrust(socketPath: string): SocketTrustProblem | null {
  // No POSIX ownership to check (and the daemon is disabled there anyway).
  if (typeof process.getuid !== "function") return null;
  const uid = process.getuid();

  let dirStat: fs.Stats;
  try {
    dirStat = fs.lstatSync(path.dirname(socketPath));
  } catch {
    return "socket-dir-missing";
  }
  if (!dirStat.isDirectory()) return "socket-dir-not-a-directory";
  if (dirStat.uid !== uid) return "socket-dir-foreign-owner";
  if (hasLooseMode(dirStat.mode)) return "socket-dir-loose-mode";

  let socketStat: fs.Stats;
  try {
    socketStat = fs.lstatSync(socketPath);
  } catch {
    // The ordinary "no daemon running" case, and by far the most common.
    return "socket-missing";
  }
  if (!socketStat.isSocket()) return "socket-not-a-socket";
  if (socketStat.uid !== uid) return "socket-foreign-owner";
  if (hasLooseMode(socketStat.mode)) return "socket-loose-mode";

  return null;
}

/** A socket directory we cannot own, and therefore cannot make private. */
export class UntrustedSocketDirError extends Error {
  constructor(
    readonly socketDir: string,
    readonly problem: string,
  ) {
    super(`refusing to use socket directory ${socketDir}: ${problem}`);
    this.name = "UntrustedSocketDirError";
  }
}

/**
 * Creates the directory 0700, repairing looser permissions if it exists.
 * Fails CLOSED when owned by someone else: `chmodSync` can't repair
 * another owner's directory, so an attacker-owned one means "no daemon".
 */
export function ensureSocketDir(socketDir: string): void {
  fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });

  // lstat, so a symlink pointing at a directory we DO own cannot launder a
  // path an attacker controls into one that passes this check.
  const stat = fs.lstatSync(socketDir);
  if (!stat.isDirectory()) {
    throw new UntrustedSocketDirError(socketDir, "not a directory");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new UntrustedSocketDirError(socketDir, "owned by another user");
  }

  fs.chmodSync(socketDir, 0o700);
}

/**
 * Tightens a freshly-bound socket to 0600. `net.Server.listen()` creates
 * it as 0755 & ~umask, world read/writable by default -- call immediately
 * after listen().
 */
export function secureSocketFile(socketPath: string): void {
  fs.chmodSync(socketPath, 0o600);
}
