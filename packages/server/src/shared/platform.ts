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
      `${raw} is not supported. Run via WSL2 on Windows, or use docker compose: https://docs.langwatch.ai/self-hosting/docker-compose`
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
    const out = execSync("ldd --version 2>&1", { encoding: "utf8", timeout: 2000 }).toLowerCase();
    if (out.includes("musl")) return "musl";
  } catch {
    // ldd missing or unreadable: rare. Glibc-based distros always ship
    // ldd with libc, so a missing probe more likely means an unusual /
    // minimal container. Default to glibc — the wrong guess on a real
    // musl host produces an immediate, obvious "cannot execute" error,
    // whereas guessing musl on glibc would download a smaller-fanout
    // binary that nobody else uses.
  }
  return "glibc";
}

export function isMac(): boolean {
  return platform() === "darwin";
}
