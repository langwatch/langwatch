/**
 * Browser QA for the experiment-archive PR (feat/experiment-archive).
 *
 * Drives a headless Chromium against a dev server, signs up a real user,
 * seeds an org/team/project + experiment via Prisma, then exercises the
 * archive flow two ways:
 *
 *   1. Direct tRPC HTTP POST to experiments.deleteExperiment with the
 *      browser's real session cookie + CSRF context. Proves the wire-level
 *      mutation works for an authenticated user.
 *   2. Screenshots of the evaluations page before / after the archive call,
 *      proving the surface user sees.
 *
 * Then asserts in Postgres that the row STILL exists with archivedAt set
 * and the slug renamed.
 *
 * Run via:
 *   DATABASE_URL=postgresql://langwatch_ci:ci_password@localhost:5432/langwatch_db?schema=public \
 *     BASE_URL=http://localhost:5571 \
 *     pnpm exec tsx e2e/experiment-archive-dogfood.ts
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { PrismaClient, ExperimentType } from "@prisma/client";
import { nanoid } from "nanoid";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5571";
const EMAIL = `qa-archive-${Date.now()}@test.local`;
const PASSWORD = "qa-archive-pass-1234";
const NAME = "Archive QA User";
const SHOTS_DIR = "./.playwright-mcp";

const prisma = new PrismaClient();

let passes = 0;
let fails = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (ok) {
    passes++;
    console.log(`  PASS ${label}${extra ? ` - ${extra}` : ""}`);
  } else {
    fails++;
    console.log(`  FAIL ${label}${extra ? ` - ${extra}` : ""}`);
  }
};

async function main() {
  if (!existsSync(SHOTS_DIR)) await mkdir(SHOTS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept().catch(() => undefined));

  console.log("\n[1] Signup");
  await page.goto(`${BASE_URL}/auth/signup`, { waitUntil: "networkidle" });
  await page.waitForSelector("form", { timeout: 15000 });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[name="name"]', NAME);
  const pwInputs = await page.locator('input[type="password"]').all();
  await pwInputs[0]!.fill(PASSWORD);
  await pwInputs[1]!.fill(PASSWORD);
  await page.click('button:has-text("Sign up")');
  await page.waitForURL((u) => !u.toString().includes("/auth/signup"), {
    timeout: 30000,
  });
  check("signup completed", true, page.url());

  await page.screenshot({ path: `${SHOTS_DIR}/01-after-signup.png`, fullPage: false });

  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) throw new Error("signup did not create a user row");

  console.log("\n[2] Seed org/team/project + 2 experiments");
  const organization = await prisma.organization.create({
    data: { name: "QA Org", slug: `qa-org-${nanoid(6)}` },
  });
  await prisma.organizationUser.create({
    data: { userId: user.id, organizationId: organization.id, role: "ADMIN" },
  });
  const team = await prisma.team.create({
    data: {
      name: "QA Team",
      slug: `qa-team-${nanoid(6)}`,
      organizationId: organization.id,
    },
  });
  await prisma.teamUser.create({
    data: { userId: user.id, teamId: team.id, role: "ADMIN" },
  });
  const project = await prisma.project.create({
    data: {
      id: `project_${nanoid()}`,
      name: "QA Project",
      slug: `qa-proj-${nanoid(6)}`,
      teamId: team.id,
      language: "python",
      framework: "openai",
      apiKey: `qa-api-key-${nanoid()}`,
    },
  });
  const liveSlug = `qa-keep-${nanoid(6)}`;
  const targetSlug = `qa-archive-${nanoid(6)}`;
  const liveExp = await prisma.experiment.create({
    data: {
      id: `experiment_${nanoid()}`,
      name: "Keep This One",
      slug: liveSlug,
      projectId: project.id,
      type: ExperimentType.BATCH_EVALUATION_V2,
    },
  });
  const targetExp = await prisma.experiment.create({
    data: {
      id: `experiment_${nanoid()}`,
      name: "Archive This One",
      slug: targetSlug,
      projectId: project.id,
      type: ExperimentType.BATCH_EVALUATION_V2,
    },
  });
  check("seeded org/team/project + experiments", true, project.id);

  console.log("\n[3] Snapshot the evaluations page (BEFORE)");
  await page.goto(`${BASE_URL}/${project.slug}/evaluations`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: `${SHOTS_DIR}/02-evaluations-before.png`,
    fullPage: true,
  });
  check("BEFORE screenshot captured", true);

  console.log("\n[4] Invoke experiments.deleteExperiment via tRPC HTTP");
  // The router's tRPC POST endpoint with the session cookie attached.
  // This is the exact wire call the UI button issues.
  const csrfHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: BASE_URL,
    "x-trpc-source": "qa-script",
  };
  const archiveRes = await page.request.post(
    `${BASE_URL}/api/trpc/experiments.deleteExperiment?batch=1`,
    {
      headers: csrfHeaders,
      data: {
        "0": { json: { projectId: project.id, experimentId: targetExp.id } },
      },
    },
  );
  check(
    "deleteExperiment tRPC call returned 2xx",
    archiveRes.status() >= 200 && archiveRes.status() < 300,
    `status=${archiveRes.status()} body=${(await archiveRes.text()).slice(0, 200)}`,
  );

  console.log("\n[5] Snapshot the evaluations page (AFTER)");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: `${SHOTS_DIR}/03-evaluations-after.png`,
    fullPage: true,
  });
  check("AFTER screenshot captured", true);

  console.log("\n[6] Verify Postgres state directly");
  const row = await prisma.experiment.findFirst({
    where: { id: targetExp.id, projectId: project.id },
  });
  check("target row STILL exists in Postgres (soft archive)", !!row);
  check("target row archivedAt is set", !!row?.archivedAt, String(row?.archivedAt));
  check(
    "target row slug was renamed (contains '-archived-')",
    !!row?.slug?.includes("-archived-"),
    row?.slug,
  );

  const liveRow = await prisma.experiment.findFirst({
    where: { id: liveExp.id, projectId: project.id },
  });
  check("untouched experiment archivedAt remains null", liveRow?.archivedAt === null);

  console.log("\n[7] Idempotent re-archive returns success and does not move archivedAt");
  const firstArchivedAt = row!.archivedAt!;
  await new Promise((r) => setTimeout(r, 50));
  const archiveRes2 = await page.request.post(
    `${BASE_URL}/api/trpc/experiments.deleteExperiment?batch=1`,
    {
      headers: csrfHeaders,
      data: {
        "0": { json: { projectId: project.id, experimentId: targetExp.id } },
      },
    },
  );
  check(
    "second deleteExperiment call also returns 2xx",
    archiveRes2.status() >= 200 && archiveRes2.status() < 300,
    `status=${archiveRes2.status()}`,
  );
  const row2 = await prisma.experiment.findFirst({
    where: { id: targetExp.id, projectId: project.id },
  });
  check(
    "archivedAt timestamp is NOT overwritten on duplicate click",
    row2?.archivedAt?.getTime() === firstArchivedAt.getTime(),
    `${row2?.archivedAt?.toISOString()} vs ${firstArchivedAt.toISOString()}`,
  );

  await browser.close();

  console.log("\n=====================================================");
  if (fails === 0) {
    console.log(`ALL CHECKS PASSED (${passes}/${passes})`);
    process.exit(0);
  } else {
    console.log(`${fails} CHECKS FAILED (${passes}/${passes + fails} passed)`);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error("QA SCRIPT CRASHED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
