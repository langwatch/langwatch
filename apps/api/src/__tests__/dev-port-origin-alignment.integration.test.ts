/**
 * The api booted wholly live on a port that is not the one the environment file names:
 * sign-in on that port is this installation, and an unaligned address is still refused.
 * @vitest-environment node
 * @see specs/auth/dev-port-origin-alignment.feature
 */
import { alignDevAuthUrlsToPort } from "@langwatch/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bootLiveApi,
  freePort,
  liveStoresConfigured,
  openLivePrisma,
  signUpSession,
  type LiveApi,
} from "./api-live.fixture.ts";

const COMMITTED_ADDRESS = "http://localhost:5560";
const WRONG_PASSWORD = "Not-The-Password-2026!x";

const database = liveStoresConfigured ? openLivePrisma({ label: "dev-port-alignment" }) : null;
const prisma = database?.prisma as NonNullable<typeof database>["prisma"];
const userIds: string[] = [];

/** Removes the accounts the sign-ups made; none of them founded an organization. */
async function removeSignedUpAccounts(): Promise<void> {
  for (const userId of userIds) {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.identifier.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }
}

/** The api served on `port` while the environment file still names the committed address. */
async function bootOnSecondPort({ aligned }: { aligned: boolean }) {
  const port = await freePort();
  const started = {
    NODE_ENV: "development",
    PORT: String(port),
    API_PORT: String(port),
    BASE_HOST: COMMITTED_ADDRESS,
    NEXTAUTH_URL: COMMITTED_ADDRESS,
  };
  const environment: Record<string, string> = {};
  const offered = aligned ? alignDevAuthUrlsToPort({ environment: started }).environment : started;
  for (const [name, value] of Object.entries(offered)) {
    if (value !== undefined) environment[name] = value;
  }
  const live = await bootLiveApi({ environment, withWorker: true });
  const baseUrl = `http://localhost:${port}`;
  const api: LiveApi = {
    ...live,
    baseUrl,
    fetch: (path, init) => fetch(`${baseUrl}${path}`, init),
  };

  return { api, close: live.close };
}

describe.skipIf(!liveStoresConfigured)(
  "sign-in on a port the environment file does not name",
  () => {
    describe("given the app is started on a different port and its address is aligned", () => {
      let booted: Awaited<ReturnType<typeof bootOnSecondPort>>;

      beforeAll(async () => {
        booted = await bootOnSecondPort({ aligned: true });
      }, 120_000);

      afterAll(async () => {
        await booted?.close();
        await removeSignedUpAccounts();
        await database?.close();
      }, 60_000);

      describe("when I sign in with a valid email and password", () => {
        /** @scenario "Sign-in succeeds on a non-default port" */
        /** @scenario "The address the app checks against follows the port it was started on" */
        it("opens a session and is not refused as coming from an unrecognised address", async () => {
          const session = await signUpSession({ api: booted.api, label: "second-port" });
          userIds.push(session.userId);

          const read = await booted.api.fetch("/api/auth/session", { headers: session.headers });

          expect(read.status).toBe(200);
          await expect(read.json()).resolves.toMatchObject({ user: { id: session.userId } });
        }, 60_000);
      });

      describe("when I sign in with a valid email and the wrong password", () => {
        /** @scenario "A wrong password is still a wrong password" */
        it("is told the email or password is wrong, not that the address is unrecognised", async () => {
          const session = await signUpSession({ api: booted.api, label: "second-port-wrong" });
          userIds.push(session.userId);

          const refused = await booted.api.fetch("/api/auth/sign-in/email", {
            method: "POST",
            headers: { origin: booted.api.baseUrl, "content-type": "application/json" },
            body: JSON.stringify({ email: session.email, password: WRONG_PASSWORD }),
          });
          const body = await refused.text();

          expect(refused.status).toBe(401);
          expect(body).toMatch(/identity_sign_in_refused/);
          expect(body).not.toMatch(/INVALID_ORIGIN/);
        }, 60_000);
      });
    });

    describe("given the same start with the address left at the committed port", () => {
      let booted: Awaited<ReturnType<typeof bootOnSecondPort>>;

      beforeAll(async () => {
        booted = await bootOnSecondPort({ aligned: false });
      }, 120_000);

      afterAll(async () => {
        await booted?.close();
      }, 60_000);

      describe("when the page the app served on its own port submits a sign-in", () => {
        it("is refused as coming from an unrecognised address", async () => {
          const refused = await booted.api.fetch("/api/auth/sign-in/email", {
            method: "POST",
            headers: { origin: booted.api.baseUrl, "content-type": "application/json" },
            body: JSON.stringify({
              email: "nobody@session-fixture.example",
              password: WRONG_PASSWORD,
            }),
          });

          expect(refused.status).toBe(403);
          expect(await refused.text()).toMatch(/INVALID_ORIGIN/);
        }, 60_000);
      });
    });
  },
);
