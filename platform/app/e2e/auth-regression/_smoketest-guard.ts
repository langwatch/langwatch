/**
 * Shared localhost guard for destructive smoketest scripts.
 *
 * These scripts do `deleteMany`, `truncate`, and raw Prisma writes
 * against `process.env.DATABASE_URL`. The naive substring check
 * `DATABASE_URL.includes("localhost")` is not safe — a remote DSN can
 * still contain that literal inside credentials or query params (e.g.
 * `postgresql://localhost:xxx@prod-host/db`). Parse the URL and require
 * the hostname itself to be in an explicit allowlist of local loopback
 * addresses before letting the script touch the database.
 *
 * Caught by CodeRabbit in PR review.
 */
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertLocalhostDatabaseUrl(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error("REFUSING TO RUN: DATABASE_URL is not set");
    process.exit(1);
  }
  let hostname: string;
  try {
    hostname = new URL(raw).hostname;
  } catch {
    console.error(
      `REFUSING TO RUN: DATABASE_URL is not a parseable URL: ${raw}`,
    );
    process.exit(1);
  }
  const normalizedHost = hostname.toLowerCase();
  if (!LOCALHOST_HOSTS.has(normalizedHost)) {
    console.error(
      `REFUSING TO RUN: DATABASE_URL hostname must be one of ` +
        `${[...LOCALHOST_HOSTS].join(", ")} — got "${hostname}"`,
    );
    process.exit(1);
  }
}
