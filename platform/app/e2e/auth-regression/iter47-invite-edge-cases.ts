/**
 * Iter 47 invitation flow edge cases — covers paths iter 44 didn't:
 *
 *   1. Already-signed-in user with matching email accepts invite
 *      (no signup-then-accept; the user is ALREADY authenticated
 *      when they hit the invite URL).
 *   2. Already-accepted invite hit again → "Invite was already
 *      accepted" → page redirects to "/".
 *   3. Expired invite → NOT_FOUND.
 *   4. Case-insensitive email match (admin invited "Alice@Acme.com",
 *      user signed in as "alice@acme.com") — verifies the iter-X
 *      case-insensitive comparison fix.
 *   5. Direct tRPC call to acceptInvite without auth → UNAUTHORIZED.
 */
import { chromium, type BrowserContext } from "playwright";
import { prisma } from "../../src/server/db";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:5571";
const TS = Date.now();

let passes = 0;
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fails++;
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
  }
};

async function signUp(
  ctx: BrowserContext,
  email: string,
  password: string,
  name: string,
) {
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/auth/signup`, { waitUntil: "networkidle" });
  await page.waitForSelector("form", { timeout: 10000 });
  await page.fill('input[name="name"]', name);
  await page.fill('input[type="email"]', email);
  const pwFields = await page.locator('input[type="password"]').all();
  await pwFields[0]!.fill(password);
  await pwFields[1]!.fill(password);
  await page.click('button:has-text("Sign up")');
  await page.waitForURL(
    (url) => !url.toString().includes("/auth/signup"),
    { timeout: 15000 },
  );
  return page;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const orgId = `iter47-org-${TS}`;
  const teamId = `iter47-team-${TS}`;
  const projectId = `iter47-project-${TS}`;

  try {
    // Set up: create the test org+team+project, plus a "founder" user
    // who owns the org. This founder doesn't get a session — we just
    // need an OrganizationUser row so the org exists.
    const founder = await prisma.user.create({
      data: {
        id: `iter47-founder-${TS}`,
        name: "Founder",
        email: `iter47-founder-${TS}@test.com`,
      },
    });
    await prisma.organization.create({
      data: {
        id: orgId,
        name: `Iter47 Org ${TS}`,
        slug: orgId,
        members: { create: { userId: founder.id, role: "ADMIN" } },
        teams: {
          create: {
            id: teamId,
            name: "Iter47 Team",
            slug: teamId,
          },
        },
      },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: "Iter47 Project",
        slug: projectId,
        apiKey: `iter47-key-${TS}`,
        teamId,
        language: "other",
        framework: "other",
      },
    });

    // ────────────────────────────────────────────────────────────
    // [1] Already-signed-in user accepts invite
    // ────────────────────────────────────────────────────────────
    console.log("\n[1] Already-signed-in user accepts invite");
    const aliceEmail = `iter47-alice-${TS}@test.com`;
    const ctxA = await browser.newContext();
    // Sign Alice up first; she has no org yet → will redirect to
    // /onboarding/welcome but that's fine, we just need her session.
    await signUp(ctxA, aliceEmail, "iter47pass1234", "Alice");

    // Now create an invite addressed to Alice.
    const aliceInvite = await prisma.organizationInvite.create({
      data: {
        email: aliceEmail,
        organizationId: orgId,
        inviteCode: `iter47-alice-${TS}`,
        role: "MEMBER",
        teamIds: teamId,
        status: "PENDING",
        expiration: new Date(Date.now() + 1000 * 60 * 60),
      },
    });

    // Alice (signed in) navigates directly to the invite URL.
    const pageA = ctxA.pages()[0]!;
    await pageA.goto(
      `${BASE_URL}/invite/accept?inviteCode=${aliceInvite.inviteCode}`,
      { waitUntil: "networkidle" },
    );
    // Wait for the accept mutation + hard-redirect.
    await pageA.waitForTimeout(5000);
    console.log(`  → final URL: ${pageA.url()}`);

    const aliceMembership = await prisma.organizationUser.findFirst({
      where: { user: { email: aliceEmail }, organizationId: orgId },
    });
    check(
      "already-signed-in user got OrganizationUser row",
      !!aliceMembership,
      `role=${aliceMembership?.role ?? "none"}`,
    );
    check(
      "already-signed-in user landed on project slug (not signin)",
      pageA.url().includes(projectId) || pageA.url().endsWith("/"),
      pageA.url(),
    );

    // ────────────────────────────────────────────────────────────
    // [2] Already-accepted invite → friendly redirect
    // ────────────────────────────────────────────────────────────
    console.log("\n[2] Re-hitting already-accepted invite → /");
    // Mark Alice's invite as ACCEPTED (already done by [1] above
    // via the acceptInvite mutation, but verify the status changed).
    const inviteAfter = await prisma.organizationInvite.findFirst({
      where: { id: aliceInvite.id, organizationId: orgId },
    });
    check(
      "invite status updated to ACCEPTED",
      inviteAfter?.status === "ACCEPTED",
      inviteAfter?.status,
    );

    const pageA2 = await ctxA.newPage();
    await pageA2.goto(
      `${BASE_URL}/invite/accept?inviteCode=${aliceInvite.inviteCode}`,
      { waitUntil: "networkidle" },
    );
    await pageA2.waitForTimeout(3000);
    console.log(`  → final URL: ${pageA2.url()}`);
    check(
      "re-accept of accepted invite redirects (not stuck on /invite/accept)",
      !pageA2.url().includes("/invite/accept"),
      pageA2.url(),
    );
    await ctxA.close();

    // ────────────────────────────────────────────────────────────
    // [3] Expired invite → NOT_FOUND error message
    // ────────────────────────────────────────────────────────────
    console.log("\n[3] Expired invite");
    const bobEmail = `iter47-bob-${TS}@test.com`;
    const expiredInvite = await prisma.organizationInvite.create({
      data: {
        email: bobEmail,
        organizationId: orgId,
        inviteCode: `iter47-expired-${TS}`,
        role: "MEMBER",
        teamIds: teamId,
        status: "PENDING",
        // Expiration in the PAST.
        expiration: new Date(Date.now() - 1000 * 60),
      },
    });

    const ctxB = await browser.newContext();
    await signUp(ctxB, bobEmail, "iter47pass1234", "Bob");
    const pageB = ctxB.pages()[0]!;
    const navTrail: string[] = [];
    pageB.on("framenavigated", (frame) => {
      if (frame === pageB.mainFrame()) navTrail.push(frame.url());
    });
    await pageB.goto(
      `${BASE_URL}/invite/accept?inviteCode=${expiredInvite.inviteCode}`,
      { waitUntil: "networkidle" },
    );
    console.log(`  → nav trail: ${JSON.stringify(navTrail)}`);
    // Wait for the mutation to fail and the SetupLayout error UI to
    // render. The page first shows LoadingScreen (no text), then on
    // mutation isError it switches to SetupLayout with an error Alert.
    // Wait specifically for the "Log Out and Try Again" button which
    // is unique to the SetupLayout error branch in invite/accept.tsx.
    try {
      await pageB.waitForSelector('button:has-text("Log Out and Try Again")', {
        timeout: 15000,
      });
    } catch {
      /* fall through to text capture below */
    }
    console.log(`  → URL: ${pageB.url()}`);

    // Capture all visible text on the page (excluding scripts).
    const visibleText = await pageB.evaluate(() => {
      return document.body.innerText ?? "";
    });
    const preview = visibleText.replace(/\s+/g, " ").slice(0, 300);
    console.log(`  → visible text: "${preview}"`);

    const lowered = visibleText.toLowerCase();
    check(
      "expired invite shows error message",
      lowered.includes("not found") ||
        lowered.includes("expired") ||
        lowered.includes("an error occurred"),
    );

    const bobMembership = await prisma.organizationUser.findFirst({
      where: { user: { email: bobEmail }, organizationId: orgId },
    });
    check(
      "no OrganizationUser row for expired invite",
      !bobMembership,
    );
    await ctxB.close();

    // ────────────────────────────────────────────────────────────
    // [4] Case-insensitive email match
    // ────────────────────────────────────────────────────────────
    console.log("\n[4] Case-insensitive invite email match");
    // Admin invites "Carol@Acme.com" but user signed up (lowercased
    // by BetterAuth) as "carol@acme.com".
    const carolMixedCaseEmail = `Iter47-Carol-${TS}@Test.com`;
    const carolInvite = await prisma.organizationInvite.create({
      data: {
        email: carolMixedCaseEmail,
        organizationId: orgId,
        inviteCode: `iter47-carol-${TS}`,
        role: "MEMBER",
        teamIds: teamId,
        status: "PENDING",
        expiration: new Date(Date.now() + 1000 * 60 * 60),
      },
    });

    const ctxC = await browser.newContext();
    // Sign up Carol — BetterAuth lowercases the email
    const carolLowerEmail = carolMixedCaseEmail.toLowerCase();
    await signUp(ctxC, carolLowerEmail, "iter47pass1234", "Carol");
    const pageC = ctxC.pages()[0]!;
    await pageC.goto(
      `${BASE_URL}/invite/accept?inviteCode=${carolInvite.inviteCode}`,
      { waitUntil: "networkidle" },
    );
    await pageC.waitForTimeout(5000);

    const carolMembership = await prisma.organizationUser.findFirst({
      where: { user: { email: carolLowerEmail }, organizationId: orgId },
    });
    check(
      "case-insensitive email match: OrganizationUser created",
      !!carolMembership,
      `role=${carolMembership?.role ?? "none"}`,
    );
    await ctxC.close();

    // ────────────────────────────────────────────────────────────
    // [5] Unauthenticated tRPC acceptInvite call → UNAUTHORIZED
    // ────────────────────────────────────────────────────────────
    console.log("\n[5] Unauth'd tRPC acceptInvite → UNAUTHORIZED");
    const danInvite = await prisma.organizationInvite.create({
      data: {
        email: `iter47-dan-${TS}@test.com`,
        organizationId: orgId,
        inviteCode: `iter47-dan-${TS}`,
        role: "MEMBER",
        teamIds: teamId,
        status: "PENDING",
        expiration: new Date(Date.now() + 1000 * 60 * 60),
      },
    });

    const ctxD = await browser.newContext();
    const pageD = await ctxD.newPage();
    const trpcRes = await pageD.request.post(
      `${BASE_URL}/api/trpc/organization.acceptInvite?batch=1`,
      {
        headers: { "Content-Type": "application/json", Origin: BASE_URL },
        data: {
          "0": { json: { inviteCode: danInvite.inviteCode } },
        },
      },
    );
    const trpcStatus = trpcRes.status();
    const trpcJson = (await trpcRes.json().catch(() => null)) as
      | Array<{ error?: { json?: { data?: { code?: string } } } }>
      | null;
    const errorCode = trpcJson?.[0]?.error?.json?.data?.code;
    check(
      "unauthenticated POST returns 401",
      trpcStatus === 401,
      `status=${trpcStatus}`,
    );
    check(
      "error code is UNAUTHORIZED",
      errorCode === "UNAUTHORIZED",
      String(errorCode),
    );

    const danMembership = await prisma.organizationUser.findFirst({
      where: {
        user: { email: `iter47-dan-${TS}@test.com` },
        organizationId: orgId,
      },
    });
    check("no OrganizationUser created from unauth call", !danMembership);
    await ctxD.close();
  } finally {
    await browser.close();

    // Clean up.
    await prisma.organizationInvite.deleteMany({
      where: { organizationId: orgId },
    });
    await prisma.teamUser.deleteMany({ where: { teamId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: orgId } });
    await prisma.project.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    // Scope cleanup to this run's TS suffix (CodeRabbit).
    const runSuffix = `-${TS}@test.com`;
    await prisma.session.deleteMany({
      where: { user: { email: { endsWith: runSuffix } } },
    });
    await prisma.account.deleteMany({
      where: { user: { email: { endsWith: runSuffix } } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: runSuffix } },
    });
  }

  console.log(`\n═══════════════════════════════════════════════════`);
  if (fails === 0) {
    console.log(`✅ ALL CHECKS PASSED (${passes}/${passes})`);
    process.exit(0);
  } else {
    console.log(
      `❌ ${fails} CHECKS FAILED (${passes}/${passes + fails} passed)`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("SMOKE TEST CRASHED:", err);
  process.exit(1);
});
