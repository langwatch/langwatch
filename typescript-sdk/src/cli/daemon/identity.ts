/**
 * Identity keying for the daemon — the security boundary of this feature.
 *
 * A daemon is a long-lived process holding resolved credentials and warm
 * per-identity state. The one thing that must be impossible is identity A's
 * warm state (or credentials) serving identity B's request.
 *
 * DECISION: one socket per identity, where identity = (endpoint, apiKey, uid).
 * The socket FILENAME is derived from a sha256 over those three values.
 *
 * WHY this is safe, rather than passing the identity per-request and having
 * one daemon isolate state internally:
 *
 *   1. A daemon process only ever holds ONE identity's credentials. There is
 *      no in-memory table to key incorrectly, no cache to poison, and no
 *      "oops, this code path read the daemon's env instead of the request's"
 *      class of bug. Cross-identity leakage is structurally impossible rather
 *      than defended against.
 *   2. A client cannot even ADDRESS another identity's daemon: the path is a
 *      one-way hash of the other identity's API key, which it does not have.
 *   3. Filesystem permissions defend the cross-*user* case: the socket is 0600
 *      inside a 0700 directory owned by the calling uid, so another user on a
 *      shared box cannot connect at all. The uid is in the hash too, so two
 *      users with the same API key still never share a socket.
 *   4. Defence in depth: the daemon re-checks the FULL fingerprint presented in
 *      the handshake against its own and refuses on mismatch, so even a stale
 *      socket file or a (astronomically unlikely) truncated-hash collision
 *      cannot cause a wrong-identity serve.
 *
 * The cost of this decision is more daemons when a user juggles many projects.
 * That is bounded by the idle timeout, and is the right trade: a leaked
 * credential is unrecoverable, a spare 40MB process is not.
 *
 * THE LOGGED-IN SINGLE-IDENTITY BOUNDARY.
 *
 * A user who authenticated via `langwatch login` (device flow) has NO
 * LANGWATCH_API_KEY in their environment — the key input to the hash is "" —
 * so every logged-in invocation on one (endpoint, uid, config path) collapses
 * to ONE daemon identity, shared across all of that user's projects. That is
 * safe only because auth is resolved PER REQUEST from config.json on disk
 * (`loadConfig` re-reads the file on every call — see
 * utils/governance/config.ts), so a logout/login between two requests takes
 * effect immediately. It follows that persisted credentials must NEVER be
 * cached in this process: an in-process auth cache would keep serving a
 * logged-out (or switched) user's requests with the previous session,
 * silently, until the idle timeout. If you are about to add such a cache,
 * don't — or key it on the config file's content hash at the very least.
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
 * Windows would need a named pipe (`\\.\pipe\...`) and has no 0600/0700
 * equivalent — its default pipe ACL is owner+admins, which is a different
 * (weaker for the admin case) security posture than the one documented above.
 * Rather than ship an unverified credential-holding IPC surface, the daemon is
 * disabled on win32 and every command runs in-process, exactly as today.
 */
export function isDaemonSupported(): boolean {
  return process.platform !== "win32";
}

/**
 * Base directory for daemon sockets.
 *
 * `$XDG_RUNTIME_DIR` when set (Linux; already per-user and 0700, and cleaned
 * on logout), otherwise `$HOME/.langwatch/run` — the same dot-directory the
 * CLI already keeps its config in.
 *
 * `os.tmpdir()` is the LAST resort, and deliberately so. On Linux without
 * `$XDG_RUNTIME_DIR` it is `/tmp`, mode 1777: any local user can PRE-CREATE
 * `/tmp/langwatch-<uid>`, own it, and leave it 0777. Our `ensureSocketDir`
 * then cannot chmod a directory it does not own, so the real daemon can never
 * bind — and the squatter is free to bind the socket itself and be handed the
 * caller's args, cwd and forwarded `LANGWATCH_*` env. A directory under `$HOME`
 * cannot be pre-created by another user, which removes the squat entirely
 * rather than merely detecting it. (`inspectSocketTrust` still detects it, for
 * `$XDG_RUNTIME_DIR`, `LANGWATCH_DAEMON_DIR` and the temp-dir fallback.)
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
    // A very long $HOME would push the socket past sockaddr_un and disable the
    // daemon outright. The temp dir is shorter; a daemon whose directory we
    // validate on every connect beats no daemon at all.
    if (
      Buffer.byteLength(underHome, "utf8") + SOCKET_FILE_BYTES <=
      MAX_SOCKET_PATH_BYTES
    ) {
      return underHome;
    }
  }
  return path.join(os.tmpdir(), leaf);
}

/**
 * Resolve the identity of the CURRENT invocation.
 *
 * Endpoint resolution goes through the CLI's single resolver so the client and
 * the daemon can never disagree about what "the endpoint" is — a drift there
 * would silently key two identical invocations to two different daemons.
 */
export function resolveIdentity(
  env: NodeJS.ProcessEnv = process.env,
): DaemonIdentity {
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
  const fingerprint = hasher
    .update(`${endpoint}\0${apiKey}\0${uid}\0${configPath}`)
    .digest("hex");

  const socketDir = daemonSocketDir();
  // 16 hex chars = 64 bits. A collision needs ~2^32 distinct identities on one
  // machine before it is even worth thinking about, and the handshake's
  // full-fingerprint check makes a collision a clean refusal, not a leak.
  const socketPath = path.join(socketDir, `${fingerprint.slice(0, 16)}.sock`);

  return { fingerprint, socketPath, socketDir, endpoint };
}

/**
 * What the client and the daemon must AGREE they are running.
 *
 * The obvious check is the CLI's semver, and it is not enough. A daemon holds a
 * module graph it loaded once; the code on disk can change underneath it without
 * the version changing at all — `npm install` of the same version, a local `npm
 * link`, and above all a developer rebuilding the bundle between two runs. In
 * every one of those the daemon keeps serving the OLD behaviour to a NEW client,
 * which is the nastiest failure this feature can have: silent, and it looks like
 * your change did not work.
 *
 * So the identity of the code is the version PLUS the size and mtime of the
 * entrypoint the process actually loaded. Any rebuild or reinstall moves it, the
 * handshake refuses, and the stale daemon is evicted.
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
 * The environment a spawned daemon must boot with in order to resolve the SAME
 * identity as the client that spawned it.
 *
 * The daemon boots in `$HOME`. Its own boot skips the dotenv load precisely so
 * a ~/.env cannot reach it (see index.ts), and this pinning is the second
 * layer of that defence: even if a ~/.env value ever did get in, a
 * `LANGWATCH_ENDPOINT` or `LANGWATCH_API_KEY` the CALLER does not have would
 * give the daemon a different identity, a different socket, and therefore a
 * daemon nobody ever connects to. Pinning the three identity inputs
 * explicitly (dotenv never overwrites a variable that is already set, even to
 * an empty string) makes that impossible.
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

/** Whether the resolved socket path fits inside sockaddr_un. */
export function isSocketPathUsable(socketPath: string): boolean {
  return Buffer.byteLength(socketPath, "utf8") <= MAX_SOCKET_PATH_BYTES;
}

/**
 * Why a socket path must not be connected to. `null` means it is safe.
 *
 * These are the CLIENT-side half of the trust model. `ensureSocketDir` and
 * `secureSocketFile` make the socket private when WE create it; they say
 * nothing about a socket somebody else created first. Without this check a
 * squatted socket is indistinguishable from our own daemon, and the client
 * pipelines `exec` — args, cwd and the forwarded `LANGWATCH_*` env, API key
 * included — before it has seen a single byte back.
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
 * Decide whether this socket path may be connected to.
 *
 * Both the socket AND its parent directory must be owned by us and carry no
 * group/other bits: a private socket inside a directory somebody else can
 * write is not private, because they can unlink it and bind their own.
 *
 * `lstat`, never `stat`: a symlink standing in for the socket (or for the
 * directory) must be REJECTED, not followed to whatever it points at.
 *
 * Every problem is soft — the caller falls back to running the command
 * in-process. A squatted socket must degrade the CLI to its pre-daemon
 * behaviour, never break it.
 */
export function inspectSocketTrust(
  socketPath: string,
): SocketTrustProblem | null {
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
 * Create the socket directory with 0700. Also repairs the mode if the
 * directory already exists with looser permissions — a world-readable
 * directory would let another user stat (though not connect to) the socket.
 *
 * Fails CLOSED when the directory is not ours. `mkdirSync`'s `mode` is subject
 * to umask and ignored outright when the directory already exists, and
 * `chmodSync` cannot repair a directory owned by somebody else — so a
 * pre-created, attacker-owned directory (the classic 1777 `/tmp` squat) leaves
 * us with a socket we can never make private. Callers must treat that as "no
 * daemon", not as a warning: a daemon whose socket cannot be made private must
 * not exist.
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
 * Tighten a freshly-bound socket to 0600.
 *
 * node's net.Server.listen() creates the socket with 0755 & ~umask, which on a
 * default umask leaves it group/other readable+writable — i.e. any local user
 * could connect and drive a credential-holding daemon. Must be called
 * immediately after listen().
 */
export function secureSocketFile(socketPath: string): void {
  fs.chmodSync(socketPath, 0o600);
}
