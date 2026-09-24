import { createApiFixture } from "@langwatch/api-fixture";
import {
  ProviderKeyInvalidError,
  type ModelProviderApi,
  type ModelProviderCredentialVerdict,
} from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { MemoryModelProviderConnectionPingChannel } from "../../channels/memory/memory.model-provider-connection-ping.channel.ts";
import type { ModelProviderPingReply } from "../../channels/model-provider-connection-ping.channel.ts";
import { ModelProviderConnectionPingService } from "../model-provider-connection-ping.service.ts";

const VERIFIED: ModelProviderCredentialVerdict = { outcome: "verified", valid: true };
const ROW = { id: "mp_1", provider: "openai", customModels: [] };

function failed(overrides: Partial<Extract<ModelProviderPingReply, { outcome: "failed" }>>) {
  return {
    outcome: "failed" as const,
    status: undefined,
    message: "",
    responseBody: "",
    thrownAs: "APICallError",
    ...overrides,
  };
}

function setup(reply?: ModelProviderPingReply) {
  const channel = MemoryModelProviderConnectionPingChannel.create(reply);
  const prepared: { model: string; projectId?: string }[] = [];
  const modelProviders = createApiFixture<ModelProviderApi>({
    prepareExecution: async (input) => {
      prepared.push(input);
      return { api_key: "sk-stored" };
    },
  });
  return {
    channel,
    prepared,
    pings: ModelProviderConnectionPingService.create({ channel, modelProviders }),
  };
}

describe("ModelProviderConnectionPingService", () => {
  describe("given a chat provider whose credential probe was happy", () => {
    describe("when the generation succeeds", () => {
      /** @scenario "A chat provider is proven by a generation, not by a listing" */
      it("reports it verified, having pinged the row the reader asked about", async () => {
        const { pings, channel, prepared } = setup();

        const verdict = await pings.verify({
          row: ROW,
          projectId: "project_1",
          credential: VERIFIED,
        });

        expect(verdict).toEqual(VERIFIED);
        expect(prepared[0]?.model).toMatch(/^mp_1\//);
        expect(channel.sent).toHaveLength(1);
        expect(channel.sent[0]).toMatchObject({
          providerKey: "openai",
          parameters: { api_key: "sk-stored" },
        });
        expect(channel.sent[0]?.model).toMatch(/^openai\//);
      });
    });

    it.each([
      [
        "out of credit",
        failed({ status: 429, responseBody: "insufficient_quota" }),
        "provider_out_of_credit",
      ],
      [
        "over its usage limit",
        failed({ status: 429, responseBody: '{"type":"usage_limit_reached"}' }),
        "provider_usage_limit_reached",
      ],
      [
        "refused the key",
        failed({ status: 401, responseBody: "Incorrect API key sk-secret-key" }),
        "provider_key_invalid",
      ],
      [
        "refused for a reason we cannot place",
        failed({ status: 400, responseBody: "bad request" }),
        "provider_refused",
      ],
    ])("when the account is %s, reports it by class", async (_label, reply, code) => {
      const { pings } = setup(reply);

      const verdict = await pings.verify({
        row: ROW,
        projectId: "project_1",
        credential: VERIFIED,
      });

      expect(verdict).toMatchObject({ outcome: "refused", valid: false, domainError: { code } });
      expect(JSON.stringify(verdict)).not.toContain("sk-secret-key");
    });

    /** @scenario "A generation that never reached the provider is not read as a refusal" */
    it("reports a generation that got no answer as unreachable", async () => {
      const { pings } = setup(failed({ thrownAs: "TypeError", message: "fetch failed" }));

      await expect(
        pings.verify({ row: ROW, projectId: "project_1", credential: VERIFIED }),
      ).resolves.toMatchObject({ domainError: { code: "provider_unreachable" } });
    });
  });

  describe("given a verdict no generation should follow", () => {
    /** @scenario "A refused credential is not asked twice" */
    it("stops at a refused credential rather than paying for a generation", async () => {
      const { pings, channel } = setup();
      const refused: ModelProviderCredentialVerdict = {
        outcome: "refused",
        valid: false,
        domainError: new ProviderKeyInvalidError({ provider: "openai" }).serialize(),
      };

      await expect(
        pings.verify({ row: ROW, projectId: "project_1", credential: refused }),
      ).resolves.toBe(refused);
      expect(channel.sent).toEqual([]);
    });

    /** @scenario "A row whose credential could not be read is not pinged" */
    it("does not ping a row whose credential could not be read", async () => {
      const { pings, channel } = setup();
      const unchecked: ModelProviderCredentialVerdict = {
        outcome: "unchecked",
        valid: true,
        reason: "no_credential",
      };

      await expect(
        pings.verify({ row: ROW, projectId: "project_1", credential: unchecked }),
      ).resolves.toBe(unchecked);
      expect(channel.sent).toEqual([]);
    });

    it("keeps the credential's verdict when the test names no project", async () => {
      const { pings, channel } = setup();

      await expect(
        pings.verify({ row: ROW, projectId: undefined, credential: VERIFIED }),
      ).resolves.toBe(VERIFIED);
      expect(channel.sent).toEqual([]);
    });

    it("keeps the credential's verdict for Codex, which has no execution road here", async () => {
      const { pings, channel } = setup();

      await pings.verify({
        row: { ...ROW, provider: "openai_codex" },
        projectId: "project_1",
        credential: VERIFIED,
      });

      expect(channel.sent).toEqual([]);
    });
  });
});
