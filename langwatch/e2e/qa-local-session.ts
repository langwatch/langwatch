/**
 * One local-only sign-in for the QA scripts that need a browser session.
 *
 * Obtaining a session means writing a known password onto a real user row,
 * so this fails closed on three independent things before it touches
 * anything: the HTTP target, the database the Prisma client will actually
 * resolve (which `DATABASE_URL` decides, not the base URL), and a password
 * supplied through the environment so no literal that could reach a real
 * account lives in source.
 *
 * Signing in goes through the auth API in-process rather than over HTTP:
 * the route rejects a cross-port Origin, and the dev server's trusted
 * origin is the default port rather than whichever one QA runs on.
 */
import { hash } from "bcrypt";

import { auth } from "../src/server/better-auth";
import { prisma } from "../src/server/db";

const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;
const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/;

export const QA_EMAIL = "dogfood@langwatch.local";

/** A Playwright cookie, ready to hand to `context.addCookies`. */
export type QaSessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
};

function requireLocalTarget(baseUrl: string): string {
  if (!LOCAL_HOST.test(baseUrl)) {
    throw new Error(
      `refusing to run QA against a non-local target: ${baseUrl}`,
    );
  }
  if (!LOCAL_DB.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("refusing to rewrite credentials on a non-local database");
  }
  const password = process.env.QA_PASSWORD;
  if (!password) {
    throw new Error("QA_PASSWORD is required so no password lives in source");
  }
  return password;
}

async function rewriteCredential(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`no user ${email}`);
  const passwordHash = await hash(password, 10);
  const existing = await prisma.account.findFirst({
    where: { userId: user.id, provider: "credential" },
  });
  if (existing) {
    await prisma.account.update({
      where: { id: existing.id },
      data: { password: passwordHash },
    });
    return;
  }
  await prisma.account.create({
    data: {
      id: `qa_cred_${user.id}`,
      userId: user.id,
      type: "credential",
      provider: "credential",
      providerAccountId: user.id,
      password: passwordHash,
    },
  });
}

async function signIn(email: string, password: string) {
  const res = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  if (res.status !== 200) {
    throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  }
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const m = /^([^=]+)=([^;]+)/.exec(c);
    if (m && m[1]!.includes("session_token")) {
      return { name: m[1]!, value: decodeURIComponent(m[2]!) };
    }
  }
  throw new Error(`no session cookie in: ${JSON.stringify(raw)}`);
}

/**
 * The cookie's domain follows the base URL's host, so a run pointed at
 * 127.0.0.1 is authenticated rather than silently anonymous.
 */
export async function localQaSessionCookie(
  baseUrl: string,
  email: string = QA_EMAIL,
): Promise<QaSessionCookie> {
  const password = requireLocalTarget(baseUrl);
  await rewriteCredential(email, password);
  const { name, value } = await signIn(email, password);
  return {
    name,
    value,
    domain: new URL(baseUrl).hostname,
    path: "/",
    httpOnly: true,
    secure: false,
  };
}
