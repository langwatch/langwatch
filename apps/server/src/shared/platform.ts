import { execSync } from "node:child_process";
import { arch, platform } from "node:os";

export type SupportedPlatform =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64"
  | "linux-x64"
  | "linux-arm64-musl"
  | "linux-x64-musl";

export class UnsupportedPlatformError extends Error {
  constructor(readonly raw: string) {
    super(
      `${raw} is not supported. Run via WSL2 on Windows, or use docker compose: https://docs.langwatch.ai/self-hosting/docker-compose`,
    );
    this.name = "UnsupportedPlatformError";
  }
}

export function detectPlatform(): SupportedPlatform {
  const os = platform();
  const cpu = arch();

  if (os === "darwin" && (cpu === "arm64" || cpu === "x64")) {
    return `darwin-${cpu}` as SupportedPlatform;
  }

  if (os === "linux" && (cpu === "arm64" || cpu === "x64")) {
    const libc = detectLibc();
    return libc === "musl" ? `linux-${cpu}-musl` : `linux-${cpu}`;
  }

  throw new UnsupportedPlatformError(`${os}-${cpu}`);
}

// Distinguish musl (Alpine, distroless) from glibc (Debian/Ubuntu/RHEL/etc.).
// `ldd --version` is the only universally-available probe — `getconf` doesn't
// expose a musl/glibc flag, and reading /lib/ld-* paths is fragile across
// distros. musl prints "musl libc (...)", glibc prints "ldd (Ubuntu GLIBC ...)".
function detectLibc(): "glibc" | "musl" {
  try {
    // Alpine's ldd (busybox-shimmed musl) prints "musl libc (...)" and
    // exits 1; glibc's ldd prints "ldd (Ubuntu GLIBC ...)" and exits 0.
    // Either way the output mentions "musl" or a "GLIBC" tag, so a single
    // case-insensitive substring check is enough.
    const out = execSync("ldd --version 2>&1", {
      encoding: "utf8",
      timeout: 2000,
    }).toLowerCase();
    if (out.includes("musl")) return "musl";
  } catch {
    // ldd missing/unreadable is rare (glibc distros ship it with libc).
    // Default to glibc: a wrong glibc guess on a musl host fails loudly
    // ("cannot execute"), while guessing musl on glibc downloads a
    // smaller-fanout binary nobody else uses.
  }
  return "glibc";
}

/** The backend's own floor: apps/backend runs TypeScript through Node's type stripping. */
export const MINIMUM_NODE_MAJOR = 24;

export class UnsupportedHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedHostError";
  }
}

/** Why this host cannot run the prebuilt app (ADR-180), or null when it can. */
export function unsupportedHostReason({
  nodeVersion,
  platform,
}: {
  nodeVersion: string;
  platform: SupportedPlatform;
}): string | null {
  const major = Number.parseInt(nodeVersion.replace(/^v/, ""), 10);
  if (!(major >= MINIMUM_NODE_MAJOR)) {
    return `LangWatch needs Node ${MINIMUM_NODE_MAJOR} or newer, and this is Node ${nodeVersion}. Install Node ${MINIMUM_NODE_MAJOR} from https://nodejs.org and run it again.`;
  }
  if (platform.endsWith("-musl")) {
    return "LangWatch has no npx build for Linux on musl (Alpine and similar). Run the Docker image instead: https://docs.langwatch.ai/self-hosting/docker-compose";
  }
  return null;
}

/** Refuses an unsupported OS, an old Node or musl before anything installs; returns the platform */
export function assertSupportedHost(): SupportedPlatform {
  const platform = detectPlatform();
  const reason = unsupportedHostReason({ nodeVersion: process.versions.node, platform });
  if (reason) throw new UnsupportedHostError(reason);
  return platform;
}

export function isMac(): boolean {
  return platform() === "darwin";
}
