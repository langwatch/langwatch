/**
 * @vitest-environment node
 *
 * Regression test for the sign-in 403 on a non-default dev port
 * (specs/auth/dev-port-origin-alignment.feature).
 *
 * This does not assert on the shape of any string. It replays the boot
 * sequence that produced the bug — the launcher aligns the app address to the
 * port it is about to bind, then the entry point loads `.env` with
 * `override: true` and puts the committed default port back — and then fires a
 * real POST at the real `/api/auth/*` route to see whether the origin gate
 * rejects it. Before the fix the second half of that sequence wins and the
 * request comes back 403 INVALID_ORIGIN.
 */
import dotenv from "dotenv";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

const { loggers } = vi.hoisted(() => ({ loggers: new Map<string, any>() }));

// The route builds its logger at module scope, and `createLogger` hands out a
// fresh pino instance per call, so there is no way to reach the one it kept.
// Memoize by name: still the real logger, just observable.
vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@langwatch/observability")>();
  return {
    ...actual,
    createLogger: (name: string, options?: any) => {
      if (!loggers.has(name)) {
        loggers.set(name, actual.createLogger(name, options));
      }
      return loggers.get(name);
    },
  };
});

/** The port this checkout took. Anything that is not the committed default. */
const APP_PORT = "5623";
/** What `platform/app/.env` ships with, and what `override: true` reinstates. */
const COMMITTED_URL = "http://localhost:5560";

const envBackup: Record<string, string | undefined> = {};

const bootWithStaleEnvFile = () => {
  for (const name of ["NODE_ENV", "PORT", "BASE_HOST", "NEXTAUTH_URL"]) {
    envBackup[name] = process.env[name];
  }

  // 1. The launcher: `scripts/start.sh` aligns the app address to $PORT.
  process.env.NODE_ENV = "development";
  process.env.PORT = APP_PORT;
  process.env.BASE_HOST = `http://localhost:${APP_PORT}`;
  process.env.NEXTAUTH_URL = `http://localhost:${APP_PORT}`;

  // 2. The entry point: `src/server.mts` loads `.env` last and with override,
  //    so an explicitly pinned value beats the launcher's derived default. That
  //    is deliberate, and it is also what reinstates the committed 5560 here.
  const dir = mkdtempSync(join(tmpdir(), "langwatch-auth-origin-"));
  const file = join(dir, ".env");
  writeFileSync(
    file,
    `BASE_HOST=${COMMITTED_URL}\nNEXTAUTH_URL=${COMMITTED_URL}\n`,
  );
  dotenv.config({ path: file, override: true, quiet: true });

  // Setup guard: the pinned .env value must have won the override.
  if (process.env.NEXTAUTH_URL !== COMMITTED_URL) {
    throw new Error(
      `setup: NEXTAUTH_URL override failed (got ${process.env.NEXTAUTH_URL})`,
    );
  }
};

const EMAIL = `origin-gate-${Date.now()}@example.com`;
const PASSWORD = "OriginGate!2026";

type HonoTestApp = {
  request: (path: string, init: RequestInit) => Promise<Response> | Response;
};

const post = async (
  app: HonoTestApp,
  origin: string,
  password = "not-the-real-password",
) =>
  app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email: EMAIL, password }),
  });

describe("given a dev checkout running on a non-default port", () => {
  let app: HonoTestApp;
  let env: { NEXTAUTH_URL: string; BASE_HOST: string };
  let prisma: typeof import("~/server/db").prisma;
  let userId: string;

  beforeAll(async () => {
    bootWithStaleEnvFile();

    // 3. The app graph evaluates, which is where the address is resolved.
    vi.resetModules();
    ({ env } = await import("~/env.mjs"));
    ({ app } = await import("~/server/routes/auth"));
    ({ prisma } = await import("~/server/db"));

    const { hash } = await import("bcrypt");
    const user = await prisma.user.create({
      data: { email: EMAIL, name: "Origin Gate", emailVerified: true },
    });
    userId = user.id;
    await prisma.account.create({
      data: {
        userId: user.id,
        provider: "credential",
        providerAccountId: user.id,
        type: "credentials",
        password: await hash(PASSWORD, 10),
      },
    });
  });

  afterAll(async () => {
    for (const [name, value] of Object.entries(envBackup)) {
      if (value === void 0) delete process.env[name];
      else process.env[name] = value;
    }
    vi.resetModules();
    await cleanupTestRows(prisma, [
      ["account", { userId }],
      ["session", { userId }],
    ]);
    await prisma.user.delete({ where: { id: userId } });
  });

  /** @scenario The address the app checks against follows the port it was started on */
  it("resolves the app address to the port it was started on", () => {
    expect(env.NEXTAUTH_URL).toBe(`http://localhost:${APP_PORT}`);
    expect(env.BASE_HOST).toBe(`http://localhost:${APP_PORT}`);
  });

  describe("when the browser posts a sign-in from that port", () => {
    /** @scenario Sign-in succeeds on a non-default port */
    it("signs the user in and hands back a session", async () => {
      const response = await post(
        app,
        `http://localhost:${APP_PORT}`,
        PASSWORD,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        user: { email: EMAIL },
      });
      expect(response.headers.get("set-cookie")).toContain("session_token");
    });

    /** @scenario A wrong password is still a wrong password */
    it("reaches the credential check and rejects the wrong password", async () => {
      const response = await post(app, `http://localhost:${APP_PORT}`);

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: "INVALID_EMAIL_OR_PASSWORD",
      });
    });
  });

  describe("when the post comes from somewhere else entirely", () => {
    it("is still refused, so the gate has not been weakened", async () => {
      const response = await post(app, "http://evil.example.com");

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "INVALID_ORIGIN" });
    });

    /** @scenario The refused address is recorded for whoever runs the installation */
    it("records both addresses so the reason is recoverable from the log", async () => {
      const warn = vi.spyOn(loggers.get("langwatch:auth"), "warn");

      await post(app, "http://evil.example.com");

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedOrigin: `http://localhost:${APP_PORT}`,
          receivedOrigin: "http://evil.example.com",
        }),
        expect.stringContaining("origin"),
      );
      warn.mockRestore();
    });
  });
});
