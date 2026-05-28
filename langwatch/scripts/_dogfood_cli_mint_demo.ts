/**
 * Drive a real `langwatch login --device` end-to-end against the live
 * dev server, programmatically approving the device-code via the
 * server's own approveDeviceCode helper + PersonalVirtualKeyService.
 *
 * Output to stdout is byte-identical to what a human user sees in
 * their terminal — no mocks. The approval-time `console.log` lines
 * are server-side and not visible to the CLI; we just bypass the
 * browser ceremony for the screenshot demo.
 */
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { prisma } from "~/server/db";
import { approveDeviceCode } from "~/server/routes/auth-cli";
import {
  PersonalVirtualKeyService,
  PersonalVirtualKeyAlreadyExistsError,
} from "@ee/governance/services/personalVirtualKey.service";

const CONTROL_PLANE = "http://localhost:5560";
const SANDBOX_CFG = "/tmp/dogfood-mint-config.json";
const USER_EMAIL = "dogfood@acme.test";

async function findUserAndOrg(): Promise<{ userId: string; organizationId: string }> {
  const user = await prisma.user.findFirst({ where: { email: USER_EMAIL } });
  if (!user) throw new Error(`user ${USER_EMAIL} not in DB`);
  const org = await prisma.organization.findFirst({ where: { slug: "acme" } });
  if (!org) throw new Error("acme org not seeded");
  return { userId: user.id, organizationId: org.id };
}

async function main() {
  // Reset sandbox + drop any LANGWATCH_CLI_CONFIG inheritance
  const env = {
    ...process.env,
    LANGWATCH_CLI_CONFIG: SANDBOX_CFG,
    LANGWATCH_ENDPOINT: CONTROL_PLANE,
    LANGWATCH_BROWSER: "none",
  };
  try { require("node:fs").unlinkSync(SANDBOX_CFG); } catch {}

  // Resolve a viable user/org for the approve hop.
  const { userId, organizationId } = await findUserAndOrg();
  console.error(`[runner] target user=${userId} org=${organizationId}`);

  // Spawn the locally-built CLI so its output is what would land in a
  // screen recording. The system-installed `langwatch` may be older than
  // the R3 CLI rewrite shipped on this PR; the dist build under
  // `typescript-sdk/dist/cli/index.js` is the authoritative artifact.
  const child = spawn(
    "node",
    ["typescript-sdk/dist/cli/index.js", "login", "--device"],
    { env, stdio: ["ignore", "pipe", "pipe"], cwd: process.cwd() + "/.." },
  );

  let buf = "";
  let userCode: string | null = null;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buf += chunk;
    process.stdout.write(chunk);
    // Look for the URL with ?user_code= query param the CLI prints.
    if (!userCode) {
      const m = buf.match(/user_code=([A-Z0-9-]+)/i);
      if (m && m[1]) userCode = m[1];
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => process.stderr.write(chunk));

  // Wait for the user_code to appear.
  for (let i = 0; i < 30 && !userCode; i++) await wait(500);
  if (!userCode) {
    child.kill("SIGTERM");
    throw new Error("CLI never printed a user_code");
  }
  console.error(`[runner] saw user_code=${userCode}`);

  // The CLI persisted the trimmed CONTROL_PLANE before starting the
  // device flow, but the device-code itself lives in Redis keyed by
  // device_code, not user_code. The wrapper at /api/auth/cli/approve
  // would normally do the user_code -> device_code lookup. We mirror
  // that lookup by hitting Redis directly via the server's auth-cli
  // helpers — easier than re-implementing the magic-link auth + CSRF
  // dance the browser approve UI requires.
  const { default: Redis } = await import("ioredis");
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const redis = new Redis(redisUrl);
  // Mirror userCodeKey() in src/server/routes/auth-cli.ts (line 213).
  const deviceCode = await redis.get(`lwcli:device:usercode:${userCode}`);
  if (!deviceCode) {
    child.kill("SIGTERM");
    throw new Error(`no device_code mapped for user_code ${userCode}`);
  }
  console.error(`[runner] resolved user_code -> device_code (len ${deviceCode.length})`);

  // Mint a personal VK + approve the device-code, mirroring the
  // /api/auth/cli/approve handler. This invokes the SAME service code
  // path the magic-link browser approval would.
  const service = PersonalVirtualKeyService.create(prisma);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  let issued;
  try {
    issued = await service.ensureDefault({
      userId,
      organizationId,
      displayName: user?.name ?? "Rogerio",
      displayEmail: user?.email ?? USER_EMAIL,
    });
  } catch (err) {
    if (err instanceof PersonalVirtualKeyAlreadyExistsError) {
      const workspace = await prisma.team.findFirst({
        where: { organizationId, ownerUserId: userId, isPersonal: true },
        select: {
          id: true,
          projects: { where: { isPersonal: true, archivedAt: null }, select: { id: true }, take: 1 },
        },
      });
      if (!workspace?.projects[0]) throw new Error("no personal workspace for additional-device path");
      issued = await service.issue({
        userId,
        organizationId,
        personalProjectId: workspace.projects[0].id,
        personalTeamId: workspace.id,
        label: `device-${userCode!.replace("-", "").toLowerCase().slice(0, 6)}`,
      });
    } else {
      throw err;
    }
  }
  console.error(`[runner] minted personal VK id=${issued.virtualKey.id}`);

  await approveDeviceCode({
    deviceCode,
    userId,
    organizationId,
    personalVk: {
      id: issued.virtualKey.id,
      label: issued.virtualKey.name,
      secret: issued.secret,
      base_url: issued.baseUrl,
    },
  });
  console.error(`[runner] approveDeviceCode flipped to approved`);

  // CLI polls every ~3s; wait for it to complete.
  const exitCode: number = await new Promise(res => child.on("close", res));
  console.error(`[runner] CLI exited code=${exitCode}`);

  // Trail with `langwatch whoami` showing the lazy-minted VK.
  console.log("\n$ langwatch whoami");
  const whoami = spawn(
    "node",
    ["typescript-sdk/dist/cli/index.js", "whoami"],
    { env, stdio: ["ignore", "pipe", "pipe"], cwd: process.cwd() + "/.." },
  );
  whoami.stdout.on("data", c => process.stdout.write(c));
  whoami.stderr.on("data", c => process.stderr.write(c));
  await new Promise(res => whoami.on("close", res));

  await redis.quit();
  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
