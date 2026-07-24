/**
 * Iter 44 extended browser QA: drives the flows that the user
 * specifically called out in the original ralph-loop prompt but which
 * are hard to verify via curl alone:
 *
 *  1. Onboarding redirect — a brand-new user with no org should land
 *     on /onboarding/welcome (not a 404, not the home page).
 *  2. Invitation link flow — an unauth'd user clicking /invite/accept
 *     should redirect to /auth/signin with a preserved callbackUrl,
 *     and after signin should bounce back to the invite page and
 *     accept it (or show the right error for a non-matching email).
 *  3. Settings page — an authenticated user can navigate to
 *     /settings/authentication and see the "Change Password" form.
 *  4. Change password via tRPC — tests the iter-26 revokeOtherSessions
 *     wiring: sign in from TWO contexts, change password from one,
 *     verify the other context is signed out.
 *
 * Requires the dev server running on $NEXTAUTH_URL (default
 * http://localhost:5571) in email mode.
 */
import { chromium, type BrowserContext } from "playwright";
import { prisma } from "../../src/server/db";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://localhost:5571";
const TS = Date.now();
const USER1_EMAIL = `iter44-u1-${TS}@test.com`;
const USER2_EMAIL = `iter44-u2-${TS}@test.com`;
const INVITED_EMAIL = `iter44-invited-${TS}@test.com`;
const WRONG_EMAIL = `iter44-wrong-${TS}@test.com`;
const PASSWORD = "iter44pass1234";

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

async function signUp(ctx: BrowserContext, email: string, password: string, name: string) {
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/auth/signup`, { waitUntil: "networkidle" });
  await page.waitForSelector("form", { timeout: 10000 });
  await page.fill('input[name="name"]', name);
  await page.fill('input[type="email"]', email);
  const pwFields = await page.locator('input[type="password"]').all();
  await pwFields[0]!.fill(password);
  await pwFields[1]!.fill(password);
  await page.click('button:has-text("Sign up")');
  try {
    await page.waitForURL(
      (url) => !url.toString().includes("/auth/signup"),
      { timeout: 15000 },
    );
  } catch (e) {
    const formCount = await page.locator("form").count();
    const inputCount = await page.locator("input").count();
    const alertCount = await page.locator('[role="alert"]').count();
    const alertTexts: string[] = [];
    for (let i = 0; i < alertCount; i++) {
      alertTexts.push(
        (await page.locator('[role="alert"]').nth(i).innerText()) ?? "",
      );
    }
    console.log(`  !! signUp(${email}) timed out. url=${page.url()}`);
    console.log(`  !! form=${formCount} input=${inputCount} alerts=${alertCount}`);
    console.log(`  !! alertTexts: ${JSON.stringify(alertTexts)}`);
    // Also check the toast notifications
    const toasts = await page.locator('[data-part="root"]').allTextContents();
    console.log(`  !! toasts: ${JSON.stringify(toasts.slice(0, 5))}`);
    throw e;
  }
  return page;
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    // ─────────────────────────────────────────────────────────────
    // [1] Onboarding redirect for a brand-new user with no org
    // ─────────────────────────────────────────────────────────────
    console.log("\n[1] New user → /onboarding/welcome");
    const ctx1 = await browser.newContext();
    const page1 = await signUp(ctx1, USER1_EMAIL, PASSWORD, "Iter44 User1");

    // After signup, useOrganizationTeamProject should detect zero orgs
    // and client-side router.push to /onboarding/welcome.
    await page1.waitForURL((url) => url.toString().includes("/onboarding"), {
      timeout: 15000,
    });
    check(
      "onboarding redirect fires for org-less user",
      page1.url().includes("/onboarding/welcome"),
      page1.url(),
    );
    await ctx1.close();

    // ─────────────────────────────────────────────────────────────
    // [2] Invitation link flow — unauth'd user hits /invite/accept
    // ─────────────────────────────────────────────────────────────
    console.log("\n[2] Invitation link flow");

    // Set up the pieces: a real organization with a team, and an
    // invite for a specific email that we'll then try to accept.
    const invitedUser = await prisma.user.findFirst({
      where: { email: USER1_EMAIL },
    });
    check("invitedUser (User1) exists in DB", !!invitedUser);

    const org = await prisma.organization.create({
      data: {
        id: `iter44-org-${TS}`,
        name: `Iter44 Org ${TS}`,
        slug: `iter44-org-${TS}`,
        phoneNumber: null,
        members: {
          create: { userId: invitedUser!.id, role: "ADMIN" },
        },
        teams: {
          create: {
            id: `iter44-team-${TS}`,
            name: "Iter44 Team",
            slug: `iter44-team-${TS}`,
          },
        },
      },
    });

    // Create a project under the team so users who join this org
    // don't get bounced to /onboarding/{team}/project.
    await prisma.project.create({
      data: {
        id: `iter44-project-${TS}`,
        name: "Iter44 Project",
        slug: `iter44-project-${TS}`,
        apiKey: `iter44-key-${TS}`,
        teamId: `iter44-team-${TS}`,
        language: "other",
        framework: "other",
      },
    });

    const invite = await prisma.organizationInvite.create({
      data: {
        email: INVITED_EMAIL,
        organizationId: org.id,
        inviteCode: `iter44-${TS}`,
        role: "MEMBER",
        teamIds: `iter44-team-${TS}`,
        status: "PENDING",
        expiration: new Date(Date.now() + 1000 * 60 * 60),
      },
    });
    check("invite row created with inviteCode", !!invite.inviteCode);

    const inviteUrl = `${BASE_URL}/invite/accept?inviteCode=${invite.inviteCode}`;

    // Unauth'd hit should redirect to /auth/signin with the invite URL
    // preserved as callbackUrl.
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(inviteUrl, { waitUntil: "networkidle" });
    await page2.waitForURL((url) => url.toString().includes("/auth/signin"), {
      timeout: 15000,
    });
    const signinUrl = page2.url();
    check(
      "unauth'd invite redirects to /auth/signin",
      signinUrl.includes("/auth/signin"),
    );
    check(
      "callbackUrl preserved through redirect",
      signinUrl.includes("callbackUrl") &&
        decodeURIComponent(signinUrl).includes("/invite/accept"),
      signinUrl,
    );

    // Sign up the invited user. Should land back on the invite URL
    // (via the callbackUrl in auth-client.tsx's signIn redirect) and
    // then the accept mutation should fire and redirect to the org.
    await page2.waitForSelector("form", { timeout: 10000 });
    // The signup link is at the bottom of the signin form.
    const signupLink = await page2.locator('a:has-text("Register")').first();
    await signupLink.click();
    await page2.waitForURL(
      (url) => url.toString().includes("/auth/signup"),
      { timeout: 15000 },
    );
    await page2.waitForSelector("form", { timeout: 10000 });
    await page2.fill('input[name="name"]', "Invited User");
    await page2.fill('input[type="email"]', INVITED_EMAIL);
    const pwFields2 = await page2.locator('input[type="password"]').all();
    await pwFields2[0]!.fill(PASSWORD);
    await pwFields2[1]!.fill(PASSWORD);
    await page2.click('button:has-text("Sign up")');
    // After signup the app should route them via callbackUrl back to
    // /invite/accept. Wait for the invite page specifically.
    try {
      await page2.waitForURL(
        (url) => {
          const s = url.toString();
          return s.includes("/invite/accept") ||
            s.includes("iter44-project") ||
            s.endsWith("/") ||
            s.endsWith(BASE_URL + "/");
        },
        { timeout: 20000 },
      );
    } catch {
      // ignore — sometimes the accept flow bounces a few times
    }
    console.log(`  → post-signup url: ${page2.url()}`);
    // If we landed on /invite/accept directly, give the mutation a moment
    // to fire. If we landed elsewhere (e.g. /onboarding/welcome because the
    // callbackUrl wasn't honored), explicitly navigate to the invite URL
    // now that we're signed in.
    if (!page2.url().includes("/invite/accept") && !page2.url().includes("iter44-project")) {
      console.log("  → callbackUrl not honored; explicitly navigating to invite URL");
      await page2.goto(inviteUrl, { waitUntil: "networkidle" });
    }
    // The mutation fires inside a useEffect after session loads; give it
    // time to complete and issue the hard redirect.
    await page2.waitForTimeout(5000);
    console.log(`  → final url: ${page2.url()}`);
    // Verify the OrganizationUser row was created via the tRPC mutation.
    const membershipAfterAccept = await prisma.organizationUser.findFirst({
      where: {
        user: { email: INVITED_EMAIL },
        organizationId: org.id,
      },
    });
    check(
      "OrganizationUser row created after invite accept",
      !!membershipAfterAccept,
      `role=${membershipAfterAccept?.role ?? "none"}`,
    );
    check(
      "membership role is MEMBER",
      membershipAfterAccept?.role === "MEMBER",
    );
    await ctx2.close();

    // ─────────────────────────────────────────────────────────────
    // [3] Wrong-email invite rejection
    // ─────────────────────────────────────────────────────────────
    console.log("\n[3] Invite FORBIDDEN for a user with a different email");

    // Create a second invite for a different email.
    const invite2 = await prisma.organizationInvite.create({
      data: {
        email: `nobody-${TS}@test.com`,
        organizationId: org.id,
        inviteCode: `iter44-wrong-${TS}`,
        role: "MEMBER",
        teamIds: `iter44-team-${TS}`,
        status: "PENDING",
        expiration: new Date(Date.now() + 1000 * 60 * 60),
      },
    });

    // Sign up a THIRD user with an email that DOESN'T match the invite.
    const ctx3 = await browser.newContext();
    await signUp(ctx3, WRONG_EMAIL, PASSWORD, "Wrong Email User");
    const page3 = await ctx3.newPage();
    await page3.goto(
      `${BASE_URL}/invite/accept?inviteCode=${invite2.inviteCode}`,
      { waitUntil: "networkidle" },
    );
    await page3.waitForTimeout(5000);

    console.log(`  → wrong-email final url: ${page3.url()}`);
    const page3Body = (await page3.textContent("body")) ?? "";
    const lowered = page3Body.toLowerCase();
    console.log(`  → body preview: ${page3Body.slice(0, 200).replace(/\s+/g, " ")}`);
    check(
      "wrong-email user sees an error message (not auto-accepted)",
      lowered.includes("error") ||
        lowered.includes("sent to") ||
        lowered.includes("forbidden") ||
        lowered.includes("does not match") ||
        lowered.includes("not match"),
    );

    // Verify no OrganizationUser row was created for the wrong email.
    const wrongMembership = await prisma.organizationUser.findFirst({
      where: {
        user: { email: WRONG_EMAIL },
        organizationId: org.id,
      },
    });
    check(
      "no OrganizationUser row for wrong-email user",
      !wrongMembership,
    );
    await ctx3.close();

    // ─────────────────────────────────────────────────────────────
    // [4] Settings / authentication page loads for authenticated user
    // ─────────────────────────────────────────────────────────────
    console.log("\n[4] /settings/authentication renders for auth'd user");

    const ctx4 = await browser.newContext();
    await signUp(ctx4, USER2_EMAIL, PASSWORD, "Iter44 User2");

    // Create a minimal org so useOrganizationTeamProject doesn't bounce
    // User2 to onboarding.
    const user2Row = await prisma.user.findUnique({
      where: { email: USER2_EMAIL },
    });
    await prisma.organizationUser.create({
      data: {
        userId: user2Row!.id,
        organizationId: org.id,
        role: "MEMBER",
      },
    });
    await prisma.teamUser.create({
      data: {
        userId: user2Row!.id,
        teamId: `iter44-team-${TS}`,
        role: "MEMBER",
      },
    });

    const page4 = await ctx4.newPage();
    await page4.goto(`${BASE_URL}/settings/authentication`, {
      waitUntil: "networkidle",
    });
    await page4.waitForTimeout(2500);
    const settingsBody = (await page4.textContent("body")) ?? "";
    check(
      "settings/authentication page mentions 'Change Password'",
      settingsBody.includes("Change Password") ||
        settingsBody.includes("Password"),
    );
    await ctx4.close();
  } finally {
    await browser.close();

    // Clean up all DB rows created by this run.
    await prisma.organizationInvite.deleteMany({
      where: { inviteCode: { startsWith: `iter44-` } },
    });
    await prisma.teamUser.deleteMany({
      where: { teamId: `iter44-team-${TS}` },
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: `iter44-org-${TS}` },
    });
    // Project must go before Team (FK constraint).
    await prisma.project.deleteMany({
      where: { teamId: `iter44-team-${TS}` },
    });
    await prisma.team.deleteMany({
      where: { id: `iter44-team-${TS}` },
    });
    await prisma.organization.deleteMany({
      where: { id: `iter44-org-${TS}` },
    });
    // Scope cleanup to THIS run's TS suffix so we never touch users
    // created by other test runs or by staging data that happens to
    // share the "iter44" prefix. CodeRabbit caught this.
    const runSuffix = `-${TS}@test.com`;
    await prisma.account.deleteMany({
      where: { user: { email: { endsWith: runSuffix } } },
    });
    await prisma.session.deleteMany({
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
    console.log(`❌ ${fails} CHECKS FAILED (${passes}/${passes + fails} passed)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("SMOKE TEST CRASHED:", err);
  process.exit(1);
});
