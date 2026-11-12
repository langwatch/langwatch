/**
 * `CLICKHOUSE_PASSWORD_FILE`: the shared ClickHouse password, re-read so a rotated Secret reaches
 * the next statement without a restart (ADR-198). One password, never a directory: the deployment
 * picks which valid password the app holds. Mount it as a volume; a `subPath` mount never updates.
 */
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger, type Logger } from "@langwatch/observability";

/** How stale a password may be before the next statement reads the file again. */
export const PASSWORD_FILE_REFRESH_MS = 1_000;

const VARIABLE = "CLICKHOUSE_PASSWORD_FILE";

/** The file named by `CLICKHOUSE_PASSWORD_FILE` could not give a password at boot. */
export class ClickHousePasswordFileError extends Error {
  constructor(path: string, reason: string) {
    super(`${VARIABLE} names "${path}", which ${reason}. Point it at a file holding one password.`);
    this.name = "ClickHousePasswordFileError";
  }
}

type Credentials = { username: string; password: string };

type PasswordFileOptions = {
  path: string;
  logger?: Pick<Logger, "warn" | "info">;
  now?: () => number;
  refreshMs?: number;
};

/** The trimmed password in `content`, or why there is none. Never echoes the content. */
function passwordIn(content: string): { password: string } | { reason: string } {
  const password = content.trim();
  return password ? { password } : { reason: "is empty" };
}

/** Why a read failed, from its error code alone. */
function unreadable(error: unknown): string {
  const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
  return code === "EISDIR" ? "is a directory" : `cannot be read (${code})`;
}

/** The password one file holds: read at boot, then again at most once per refresh. */
export class ClickHousePasswordFile {
  private password: string;
  private readAt: number;
  private refreshing: Promise<string> | undefined;
  private failing = false;

  private readonly path: string;
  private readonly logger: Pick<Logger, "warn" | "info">;
  private readonly now: () => number;
  private readonly refreshMs: number;

  private constructor(options: Required<PasswordFileOptions> & { initial: string }) {
    this.path = options.path;
    this.logger = options.logger;
    this.now = options.now;
    this.refreshMs = options.refreshMs;
    this.password = options.initial;
    this.readAt = options.now();
  }

  /** Reads the file now and throws {@link ClickHousePasswordFileError} if it gives no password. */
  static open({
    path,
    logger = createLogger("langwatch:clickhouse:password-file"),
    now = () => globalThis.performance.now(),
    refreshMs = PASSWORD_FILE_REFRESH_MS,
  }: PasswordFileOptions): ClickHousePasswordFile {
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch (error) {
      throw new ClickHousePasswordFileError(path, unreadable(error));
    }
    const read = passwordIn(content);
    if ("reason" in read) throw new ClickHousePasswordFileError(path, read.reason);
    return new ClickHousePasswordFile({ path, logger, now, refreshMs, initial: read.password });
  }

  /** The current password; a file that stopped giving one keeps the last good password. */
  async current(): Promise<string> {
    if (this.now() - this.readAt < this.refreshMs) return this.password;
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    let read: { password: string } | { reason: string };
    try {
      read = passwordIn(await readFile(this.path, "utf8"));
    } catch (error) {
      read = { reason: unreadable(error) };
    }
    this.readAt = this.now();
    if ("reason" in read) {
      if (!this.failing) {
        this.logger.warn(
          { variable: VARIABLE, path: this.path, reason: read.reason },
          "ClickHouse password file gives no password; keeping the last good one",
        );
      }
      this.failing = true;
      return this.password;
    }
    if (this.failing) {
      this.logger.info(
        { variable: VARIABLE, path: this.path },
        "ClickHouse password file readable again",
      );
    }
    this.failing = false;
    this.password = read.password;
    return this.password;
  }
}

/** The URL's user, as the driver reads it; `default` when the URL names none. */
export function usernameOf(url: string): string {
  return decodeURIComponent(new URL(url).username) || "default";
}

const STATEMENT_METHODS = new Set<PropertyKey>(["query", "insert", "command", "exec"]);

type StatementParams = { auth?: unknown };
type PingParams = StatementParams & { select?: boolean };

/**
 * The client, with every statement logging in as `username` with the file's current password.
 * A statement that names its own `auth` keeps it. A plain `/ping` checks no credentials, so only
 * a `SELECT` ping is given them.
 */
export function authenticatedFromFile({
  client,
  username,
  passwordFile,
}: {
  client: ClickHouseClient;
  username: string;
  passwordFile: ClickHousePasswordFile;
}): ClickHouseClient {
  const credentials = async (): Promise<Credentials> => ({
    username,
    password: await passwordFile.current(),
  });
  return new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (STATEMENT_METHODS.has(property)) {
        return async (params: StatementParams) =>
          value.call(target, { ...params, auth: params.auth ?? (await credentials()) });
      }
      if (property === "ping") {
        return async (params?: PingParams) =>
          value.call(
            target,
            params?.select ? { ...params, auth: params.auth ?? (await credentials()) } : params,
          );
      }
      return value.bind(target);
    },
  });
}
