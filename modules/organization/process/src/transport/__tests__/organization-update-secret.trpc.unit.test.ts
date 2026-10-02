import { bindTrpcFact, createTrpcRuntime } from "@langwatch/api/trpc";
import type { OrganizationApi } from "@langwatch/organization-contract";
/**
 * @vitest-environment node
 *
 * `organization.update`: a blank S3 secret beside an endpoint leaves it unchanged.
 * Spec: specs/projects/projects-browser-door.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { organizationSessionPersonFact, organizationTrpcTransport } from "../organization.trpc.ts";

type TestContext = {
  actor: { id: string };
  person: { name: string | null; email: string | null } | null;
};

const updateSettings = vi.fn<OrganizationApi["updateSettings"]>();

const members = trpcTestMembers<TestContext>({
  overrides: { entitlements: { holds: async () => true } },
});

const app = createApiFixture<OrganizationApi>({ updateSettings });
const trpc = initTRPC.context<TestContext>().create();
const router = createTrpcRuntime<TestContext>({
  root: trpc,
  procedure: trpc.procedure,
  members,
}).mount(organizationTrpcTransport, () => app, {
  facts: [bindTrpcFact(organizationSessionPersonFact, (ctx) => ctx.person)],
});
const caller = router.createCaller({
  actor: { id: "user_ana" },
  person: { name: "Ana", email: "ana@acme.com" },
});

describe("organization.update over the S3 secret", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSettings.mockResolvedValue({ traceShareRevocationRequired: false });
  });

  /** @scenario A blank storage secret leaves the stored secret unchanged */
  it("leaves the stored secret alone when the form sends it blank beside an endpoint", async () => {
    await caller.update({
      organizationId: "org_1",
      name: "Acme",
      s3Endpoint: "https://s3.example",
      s3AccessKeyId: "AKIA",
      s3SecretAccessKey: "",
    });

    expect(updateSettings.mock.calls[0]?.[0].s3SecretAccessKey).toBeUndefined();
  });

  /** @scenario A new storage secret replaces the stored one */
  it("passes a new secret through", async () => {
    await caller.update({
      organizationId: "org_1",
      name: "Acme",
      s3Endpoint: "https://s3.example",
      s3AccessKeyId: "AKIA",
      s3SecretAccessKey: "shh",
    });

    expect(updateSettings.mock.calls[0]?.[0].s3SecretAccessKey).toBe("shh");
  });

  /** @scenario Clearing the storage settings clears the stored secret */
  it("clears the secret when the whole storage block is blank", async () => {
    await caller.update({ organizationId: "org_1", name: "Acme" });

    expect(updateSettings.mock.calls[0]?.[0].s3SecretAccessKey).toBeNull();
  });

  /** @scenario A storage secret needs an endpoint and a key id */
  it("refuses a secret with no endpoint or key id", async () => {
    await expect(
      caller.update({ organizationId: "org_1", name: "Acme", s3SecretAccessKey: "shh" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(updateSettings).not.toHaveBeenCalled();
  });
});
