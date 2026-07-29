/**
 * @vitest-environment node
 *
 * A coding agent that exports OTLP without a `langwatch <tool>` wrapper has
 * no terminal to warn in when its ingestion key stops working, so the
 * rejection has to be recorded server-side for the dashboard to show it.
 * These run against real Postgres because the whole point is the attribution
 * lookup: the token carries a lookup id, and the owning user has to come back
 * out of it even for a key whose owner was deactivated.
 *
 * Spec: specs/ai-governance/cli-onboarding/expired-ingest-key-notice.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { IngestionKeyService } from "@ee/governance/services/ingestionKey.service";
import { prisma } from "~/server/db";

import { recordExpiredIngestKeyAttempt } from "../expiredIngestKeyNotice";

const suffix = nanoid(8);
const ORG_ID = `org-eik-${suffix}`;
const USER_ID = `usr-eik-${suffix}`;
const TEAM_ID = `team-eik-${suffix}`;
const PROJECT_ID = `proj-eik-${suffix}`;

const ingestKeys = IngestionKeyService.create(prisma);

/** Fresh source type per key so `ensureForProject` mints instead of reusing. */
async function mintKey(sourceType: string): Promise<string> {
  const issued = await ingestKeys.ensureForProject({
    callerUserId: USER_ID,
    ownerUserId: USER_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    sourceType,
  });
  return issued.token;
}

async function readStamp(): Promise<Date | null> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: USER_ID },
    select: { expiredIngestKeyAt: true },
  });
  return user.expiredIngestKeyAt;
}

describe("recordExpiredIngestKeyAttempt", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: ORG_ID, name: `EIK ${suffix}`, slug: `eik-${suffix}` },
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `eik-${suffix}@example.com`,
        name: "EIK User",
      },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: USER_ID, role: "ADMIN" },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: USER_ID,
        role: "ADMIN",
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        organizationId: ORG_ID,
        name: `team ${suffix}`,
        slug: `team-${suffix}`,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        teamId: TEAM_ID,
        name: `proj ${suffix}`,
        slug: `proj-${suffix}`,
        apiKey: `proj-key-${suffix}`,
        language: "other",
        framework: "other",
      },
    });
  });

  afterAll(async () => {
    await prisma.roleBinding
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.apiKey
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.project
      .deleteMany({ where: { teamId: TEAM_ID } })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.organizationUser
      .deleteMany({ where: { organizationId: ORG_ID } })
      .catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: USER_ID } }).catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: ORG_ID } })
      .catch(() => undefined);
  });

  beforeEach(async () => {
    await prisma.user.update({
      where: { id: USER_ID },
      data: { expiredIngestKeyAt: null, expiredIngestKeyDismissedAt: null },
    });
  });

  /** @scenario "A revoked ingestion key stamps its owner" */
  it("stamps the owning user when a revoked ingestion key is presented", async () => {
    const token = await mintKey(`claude_code_${nanoid(6)}`);
    await prisma.apiKey.updateMany({
      where: { organizationId: ORG_ID, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const result = await recordExpiredIngestKeyAttempt(token);

    expect(result.recorded).toBe(true);
    expect(await readStamp()).toBeInstanceOf(Date);
  });

  /** @scenario "A key whose owner was deactivated is still attributed" */
  it("stamps a key whose owner was deactivated, which authentication hides", async () => {
    const token = await mintKey(`codex_${nanoid(6)}`);
    await prisma.apiKey.updateMany({
      where: { organizationId: ORG_ID, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await prisma.user.update({
      where: { id: USER_ID },
      data: { deactivatedAt: new Date() },
    });

    try {
      const result = await recordExpiredIngestKeyAttempt(token);
      expect(result.recorded).toBe(true);
      expect(await readStamp()).toBeInstanceOf(Date);
    } finally {
      await prisma.user.update({
        where: { id: USER_ID },
        data: { deactivatedAt: null },
      });
    }
  });

  /** @scenario "Repeated attempts with the same key record once a day" */
  it("records at most once a day per key, so a retrying agent stays cheap", async () => {
    const token = await mintKey(`gemini_${nanoid(6)}`);
    await prisma.apiKey.updateMany({
      where: { organizationId: ORG_ID, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    expect((await recordExpiredIngestKeyAttempt(token)).recorded).toBe(true);

    const repeat = await recordExpiredIngestKeyAttempt(token);
    expect(repeat.recorded).toBe(false);
    expect(repeat.reason).toBe("deduplicated");
  });

  /** @scenario "A working key is never mistaken for a dead one" */
  it("stays quiet for a key that is perfectly usable", async () => {
    const token = await mintKey(`opencode_${nanoid(6)}`);

    const result = await recordExpiredIngestKeyAttempt(token);

    expect(result.recorded).toBe(false);
    expect(result.reason).toBe("key_usable");
    expect(await readStamp()).toBeNull();
  });

  /** @scenario "A bearer that is not a LangWatch key is ignored" */
  it("ignores a bearer that is not a LangWatch key at all", async () => {
    const result = await recordExpiredIngestKeyAttempt("sk-ant-not-ours");

    expect(result.recorded).toBe(false);
    expect(result.reason).toBe("not_langwatch_key");
    expect(await readStamp()).toBeNull();
  });

  /** @scenario "A well-shaped token for an unknown key is ignored" */
  it("ignores a well-shaped token whose lookup id belongs to nobody", async () => {
    const result = await recordExpiredIngestKeyAttempt(
      `ik-lw-${nanoid(16)}_${nanoid(48)}`,
    );

    expect(result.recorded).toBe(false);
    expect(result.reason).toBe("not_langwatch_key");
    expect(await readStamp()).toBeNull();
  });
});
