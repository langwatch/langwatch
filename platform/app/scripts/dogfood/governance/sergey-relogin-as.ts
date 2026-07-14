/**
 * Programmatic device-flow login as a specified user.
 *
 * Reuses the local CLI binary + drives the device-flow approval via
 * the server's own approveDeviceCode helper + PersonalVirtualKeyService,
 * mirroring scripts/_dogfood_cli_mint_demo.ts but parametrised by
 * --email so a dogfood operator can switch which user's session lands
 * in ~/.langwatch/config.json without going through the magic-link UI.
 *
 *   pnpm tsx scripts/dogfood/governance/sergey-relogin-as.ts \
 *     --email andre@langwatch.local \
 *     --endpoint http://localhost:5560
 */
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { approveDeviceCode } from "~/server/routes/auth-cli";
import { PersonalVirtualKeyService } from "@ee/governance/services/personalVirtualKey.service";

interface Args {
  email: string;
  endpoint: string;
  configPath: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {
    endpoint: "http://localhost:5560",
    configPath: `${process.env.HOME}/.langwatch/config.json`,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--email") out.email = argv[++i];
    else if (argv[i] === "--endpoint") out.endpoint = argv[++i];
    else if (argv[i] === "--config") out.configPath = argv[++i];
  }
  if (!out.email) throw new Error("--email is required");
  return out as Args;
}

async function main() {
  const args = parseArgs(process.argv);
  const raw = new PrismaClient();

  const userRows: any[] = await raw.$queryRawUnsafe(
    `SELECT id, email, name FROM mydb."User" WHERE email=$1 LIMIT 1`,
    args.email,
  );
  if (!userRows[0]) throw new Error(`user ${args.email} not in DB`);
  const user = userRows[0];

  const orgRows: any[] = await raw.$queryRawUnsafe(
    `SELECT o.id, o.slug, o.name
     FROM mydb."OrganizationUser" ou
     JOIN mydb."Organization" o ON o.id = ou."organizationId"
     WHERE ou."userId"=$1
     ORDER BY o."createdAt" DESC
     LIMIT 1`,
    user.id,
  );
  if (!orgRows[0]) {
    throw new Error("no Organization row joined to this user's OrganizationUser");
  }
  const org = orgRows[0];
  const organizationId = org.id;
  console.error(
    `[relogin] user=${user.id} org=${organizationId} slug=${org.slug}`,
  );

  try {
    require("node:fs").unlinkSync(args.configPath);
  } catch {}

  const env = {
    ...process.env,
    LANGWATCH_CLI_CONFIG: args.configPath,
    LANGWATCH_ENDPOINT: args.endpoint,
    LANGWATCH_BROWSER: "none",
  };

  // Drive the locally-built CLI artifact (typescript-sdk/dist/cli/index.js)
  // rather than whatever `langwatch` resolves to on PATH — the globally-
  // installed binary lags this PR's CLI surface (e.g. --device flag was
  // added recently and may be missing from the installed npm package).
  const cliEntry = require("node:path").resolve(
    process.cwd(),
    "..",
    "typescript-sdk",
    "dist",
    "cli",
    "index.js",
  );
  // stdin is "pipe" so we can dismiss the post-login "Save the langwatch
  // export block to ~/.zshrc? [Y/n/never]" prompt with "never" — that
  // prompt is rchaves's #5 regression to be fixed in the CLI itself; here
  // we just don't want this script to hang on it forever.
  const child = spawn("node", [cliEntry, "login", "--device"], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buf = "";
  let userCode: string | null = null;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c) => {
    buf += c;
    process.stdout.write(c);
    const m = buf.match(/user_code=([A-Z0-9-]+)/i);
    if (m && m[1] && !userCode) userCode = m[1];
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => process.stderr.write(c));

  for (let i = 0; i < 40 && !userCode; i++) await wait(500);
  if (!userCode) {
    child.kill();
    throw new Error("CLI never printed a user_code");
  }
  console.error(`[relogin] user_code=${userCode}`);

  const Redis = (await import("ioredis")).default;
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const deviceCode = await redis.get(`lwcli:device:usercode:${userCode}`);
  if (!deviceCode) {
    child.kill();
    throw new Error(`no device_code for user_code ${userCode}`);
  }

  const { prisma } = await import("~/server/db");
  const service = PersonalVirtualKeyService.create(prisma);

  // Try ensureDefault first; if the user already has a default personal VK
  // (the secret was minted in a prior login + only the hash is stored,
  // so we can't reuse it here), fall back to issuing a fresh
  // per-relogin-device VK with a unique label. Mirrors what a clean
  // re-install on a new device does — the original key stays valid for
  // any prior device but THIS device gets its own secret.
  let issued;
  try {
    issued = await service.ensureDefault({
      userId: user.id,
      organizationId,
      displayName: user.name ?? args.email,
      displayEmail: user.email,
    });
  } catch (err: any) {
    if (err?.constructor?.name !== "PersonalVirtualKeyAlreadyExistsError") {
      throw err;
    }
    // Need the user's personal workspace to issue() — same as ensureDefault
    // would have used. Re-derive it via the public ensurePersonalWorkspace
    // entrypoint on the service. If that's not exported, find the personal
    // project owned by this user.
    const personalProjectRows: any[] = await raw.$queryRawUnsafe(
      `SELECT id, "teamId" FROM mydb."Project"
       WHERE "ownerUserId"=$1 AND "isPersonal"=true AND "archivedAt" IS NULL
       LIMIT 1`,
      user.id,
    );
    if (!personalProjectRows[0]) {
      throw new Error(
        "no personal project for user — ensureDefault failed AND fallback can't issue",
      );
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    issued = await service.issue({
      userId: user.id,
      organizationId,
      personalProjectId: personalProjectRows[0].id,
      personalTeamId: personalProjectRows[0].teamId,
      label: `dogfood-relogin-${ts}`,
    });
    console.error(
      `[relogin] reused existing default VK ${err.virtualKeyId} for this user; issued fresh per-relogin VK ${issued.virtualKey.id} (secret captured for config.json write)`,
    );
  }
  console.error(`[relogin] vk=${issued.virtualKey.id}`);

  await approveDeviceCode({
    deviceCode,
    userId: user.id,
    organizationId,
    personalVk: {
      id: issued.virtualKey.id,
      label: issued.virtualKey.name ?? "default-personal",
      secret: issued.secret!,
      base_url: "http://localhost:5563",
    },
  });
  console.error(`[relogin] approved, waiting for poll → saveConfig → shell-rc prompt`);

  // The CLI polls control-plane on dc.interval (typically 5s). Wait
  // for the ceremony output ("Gateway:" + "Dashboard:" lines, which
  // are printed AFTER saveConfig has persisted the session). Once
  // those land, dismiss the inevitable "Save the langwatch export
  // block to ~/.zshrc? [Y/n/never]" prompt with "never".
  const sawCeremony = await Promise.race([
    new Promise<boolean>((resolve) => {
      const handler = (c: string) => {
        if (buf.includes("Dashboard:")) {
          child.stdout.off("data", handler);
          resolve(true);
        }
      };
      child.stdout.on("data", handler);
    }),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 30000)),
  ]);
  if (!sawCeremony) {
    console.error(`[relogin] never saw ceremony (Dashboard: line) within 30s`);
  }

  if (child.stdin && !child.stdin.destroyed) {
    child.stdin.write("never\n");
    child.stdin.end();
  }

  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10000)),
  ]);
  if (!exited) {
    console.error(`[relogin] CLI did not exit within 10s of stdin-close, SIGKILL`);
    child.kill("SIGKILL");
  }
  await redis.quit();
  await raw.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
