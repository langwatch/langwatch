/**
 * A personal testing-licence token is minted through the CLI browser sign-in, and only for
 * someone holding `ops:manage` at platform scope (ADR-180).
 * @see specs/self-hosting/connected-services/testing-licenses.feature
 */
import { MemorySharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MemoryCliDeviceSettlementChannel } from "../../../../channels/memory/memory.cli-device-settlement.channel.ts";
import { MemoryCliDeviceSessionRepository } from "../../../../repositories/memory/memory.cli-device-session.repository.ts";
import type { CliDeviceDirectory } from "../cli-device-directory.service.ts";
import {
  CliDeviceFlowService,
  type CliDeviceFlowCollaborators,
} from "../cli-device-flow.service.ts";
import { CliDeviceSessionService } from "../cli-device-session.service.ts";

const USER_ID = "usr-ops";
const ORGANIZATION_ID = "org-langwatch";
const TOKEN = "lwtl_personal_token";
const EXPIRES_AT = "2027-01-13T00:00:00.000Z";

const startedSchema = z.object({ device_code: z.string(), user_code: z.string() });

/** The grant over real memory session state, a person who is a member, and a recording mint. */
function testingLicenseWorld({ holdsOpsManage }: { holdsOpsManage: boolean }) {
  const permissions = { holdsOpsManage };
  const sessions = CliDeviceSessionService.create({
    store: MemoryCliDeviceSessionRepository.create(),
    settlements: MemoryCliDeviceSettlementChannel.create(),
    rotations: MemorySharedCredentialStore.create({
      now: () => Temporal.Instant.fromEpochMilliseconds(Date.now()),
    }),
  });
  const mintedFor: string[] = [];
  const collaborators = createApiFixture<CliDeviceFlowCollaborators>({
    sessions: () => sessions,
    directory: () =>
      createApiFixture<CliDeviceDirectory>({
        getPerson: async () => ({ id: USER_ID, name: "Ops", email: "ops@langwatch.test" }),
        getOrganization: async () => ({
          id: ORGANIZATION_ID,
          name: "LangWatch",
          slug: "langwatch",
        }),
        hasActiveMembership: async () => true,
      }),
    session: async () => ({ id: USER_ID, email: "ops@langwatch.test" }),
    holdsOpsManage: async () => permissions.holdsOpsManage,
    mintTestingLicenseToken: async ({ userId }) => {
      mintedFor.push(userId);

      return { token: TOKEN, expiresAt: EXPIRES_AT };
    },
    publicBaseUrl: () => "https://app.test",
  });
  const flow = CliDeviceFlowService.create({ collaborators });

  async function start() {
    const started = await flow.startDeviceCode({
      raw: JSON.stringify({ credential_type: "testing_license" }),
    });

    return startedSchema.parse(started.body);
  }

  function approve({ userCode }: { userCode: string }) {
    return flow.approveDeviceCode({
      raw: JSON.stringify({ user_code: userCode, organization_id: ORGANIZATION_ID }),
      headers: new Headers(),
    });
  }

  function exchange({ deviceCode }: { deviceCode: string }) {
    return flow.exchangeDeviceCode({ raw: JSON.stringify({ device_code: deviceCode }) });
  }

  return { permissions, sessions, mintedFor, start, approve, exchange };
}

describe("the CLI device flow for a testing-licence token", () => {
  describe("when the approving person holds ops permissions", () => {
    /** @scenario "A person with ops permissions mints a personal token through the browser sign-in" */
    it("hands the CLI a personal token and spends the code", async () => {
      const world = testingLicenseWorld({ holdsOpsManage: true });
      const { device_code, user_code } = await world.start();

      await world.approve({ userCode: user_code });
      const answer = await world.exchange({ deviceCode: device_code });

      expect(answer.body).toEqual({
        kind: "testing_license",
        testing_license_token: TOKEN,
        expires_at: EXPIRES_AT,
      });
      await expect(world.exchange({ deviceCode: device_code })).rejects.toMatchObject({
        httpStatus: 408,
        refusal: { error: "expired_token" },
      });
      expect(world.mintedFor).toEqual([USER_ID]);
    });
  });

  describe("when the approving person holds no ops permissions", () => {
    /** @scenario "The browser sign-in refuses a testing-license token to someone without ops permissions" */
    it("refuses the approval with a named code and mints nothing", async () => {
      const world = testingLicenseWorld({ holdsOpsManage: false });
      const { device_code, user_code } = await world.start();

      const refusal = world.approve({ userCode: user_code });

      await expect(refusal).rejects.toMatchObject({
        httpStatus: 403,
        refusal: { error: "testing_license_requires_ops_manage" },
      });
      expect((await world.sessions.getDeviceCode(device_code)).status).toBe("pending");
      expect(world.mintedFor).toEqual([]);
    });
  });

  describe("when ops permissions were removed between approval and exchange", () => {
    it("refuses the exchange, spends the code and mints nothing", async () => {
      const world = testingLicenseWorld({ holdsOpsManage: true });
      const { device_code, user_code } = await world.start();
      await world.approve({ userCode: user_code });
      world.permissions.holdsOpsManage = false;

      await expect(world.exchange({ deviceCode: device_code })).rejects.toMatchObject({
        httpStatus: 403,
        refusal: { error: "testing_license_requires_ops_manage" },
      });
      await expect(world.sessions.getDeviceCode(device_code)).rejects.toMatchObject({
        httpStatus: 408,
      });
      expect(world.mintedFor).toEqual([]);
    });
  });
});
