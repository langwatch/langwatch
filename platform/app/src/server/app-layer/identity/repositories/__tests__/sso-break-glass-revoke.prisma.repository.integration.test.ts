import { SsoBreakGlassService } from "@langwatch/identity-server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaSsoBreakGlassRepository } from "../sso-break-glass.prisma.repository";

const RUN = `${Date.now()}`;
const ORG = `org_break_glass_${RUN}`;
const OTHER_ORG = `org_break_glass_other_${RUN}`;
const T0 = 1_756_000_000_000;
const FIRST = `ssobg_a_${RUN}`;
const SECOND = `ssobg_b_${RUN}`;
const FOREIGN = `ssobg_foreign_${RUN}`;
const ids = [FIRST, SECOND, FOREIGN];

const service = () =>
  new SsoBreakGlassService({
    bindings: new PrismaSsoBreakGlassRepository(prisma),
    notifier: { warn: async () => void 0 },
    newBindingId: () => `unused_${RUN}`,
    organizationHasActiveConnection: async () => true,
    holderIsEligible: async () => true,
    now: () => T0,
  });

async function seed(id: string, organizationId = ORG, ended = false) {
  await prisma.ssoBreakGlassBinding.create({
    data: {
      id,
      organizationId,
      userId: `user_${id}`,
      grantedByUserId: "user_admin",
      grantedAt: new Date(T0 - 1_000),
      expiresAt: new Date(T0 + 60_000),
      supersededAt: ended ? new Date(T0 - 500) : null,
      renewedFromId: null,
      warnedDays: [],
    },
  });
}

afterAll(async () => {
  await prisma.ssoBreakGlassBinding.deleteMany({ where: { id: { in: ids } } });
});

beforeEach(async () => {
  await prisma.ssoBreakGlassBinding.deleteMany({ where: { id: { in: ids } } });
});

describe("atomic break-glass revocation", () => {
  it("lets exactly one concurrent revocation end while one recovery path remains", async () => {
    await seed(FIRST);
    await seed(SECOND);

    const attempts = await Promise.allSettled([
      service().revoke({ bindingId: FIRST, organizationId: ORG }),
      service().revoke({ bindingId: SECOND, organizationId: ORG }),
    ]);

    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(
      attempts.filter(
        (attempt) =>
          attempt.status === "rejected" && attempt.reason?.code === "sso_break_glass_last_way_in",
      ),
    ).toHaveLength(1);
    expect(
      await prisma.ssoBreakGlassBinding.count({
        where: {
          organizationId: ORG,
          supersededAt: null,
          expiresAt: { gt: new Date(T0) },
        },
      }),
    ).toBe(1);
  });

  it("does not mutate a binding through another organization", async () => {
    await seed(FOREIGN, OTHER_ORG);

    await expect(service().revoke({ bindingId: FOREIGN, organizationId: ORG })).rejects.toThrow(
      /not one of organization/,
    );
    expect(await prisma.ssoBreakGlassBinding.findUnique({ where: { id: FOREIGN } })).toMatchObject({
      supersededAt: null,
    });
  });

  it("returns an already-ended binding without rewriting it", async () => {
    await seed(FIRST, ORG, true);
    const ended = await service().revoke({ bindingId: FIRST, organizationId: ORG });

    expect(ended.supersededAtMs).toBe(T0 - 500);
  });
});
