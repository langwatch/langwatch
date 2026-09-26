/**
 * @vitest-environment node
 * @see specs/features/agents/voice-phone.feature
 * `getCredential` reads a Twilio row's three keys, or refuses with `voice_key_missing`.
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  GatewayElevenLabsCredentialRepository,
  type GatewayElevenLabsProviderRow,
} from "../repositories/gateway-elevenlabs-credential.repository.ts";
import { TwilioCredentialService } from "../services/twilio-credential.service.ts";

class FixedProviderRows extends GatewayElevenLabsCredentialRepository {
  constructor(private readonly row: GatewayElevenLabsProviderRow | null) {
    super();
  }

  async findProviderRow(): Promise<GatewayElevenLabsProviderRow | null> {
    return this.row;
  }
}

function serviceOver(input: { provider: string; keys: Record<string, unknown> }) {
  const reads: unknown[] = [];
  const service = TwilioCredentialService.create({
    providers: new FixedProviderRows({
      provider: input.provider,
      organizationId: "org_1",
      customKeys: "cipher",
    }),
    credentials: {
      readCustomKeys: (stored) => {
        reads.push(stored);
        return input.keys;
      },
    },
  });
  return { service, reads };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.catch((caught: unknown) => caught);
  return HandledError.isHandled(error) ? error.code : undefined;
}

const ALL_KEYS = {
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: "tok-secret",
  TWILIO_FROM_NUMBER: "+14155550000",
};

describe("getCredential", () => {
  describe("when the row is a Twilio row with all three keys", () => {
    it("returns the account SID, auth token and from-number", async () => {
      const { service } = serviceOver({ provider: "twilio", keys: ALL_KEYS });

      const result = await service.getCredential({ modelProviderId: "prov_1" });

      expect(result).toEqual({
        accountSid: "AC123",
        authToken: "tok-secret",
        fromNumber: "+14155550000",
      });
    });
  });

  describe("when a required key is missing", () => {
    it("refuses with voice_key_missing rather than a half-formed credential", async () => {
      const { service } = serviceOver({
        provider: "twilio",
        keys: { TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "tok-secret" },
      });

      expect(await codeOf(service.getCredential({ modelProviderId: "prov_1" }))).toBe(
        "voice_key_missing",
      );
    });
  });

  describe("when the row is not a Twilio row", () => {
    it("refuses without reading any key", async () => {
      const { service, reads } = serviceOver({ provider: "openai", keys: ALL_KEYS });

      expect(await codeOf(service.getCredential({ modelProviderId: "prov_1" }))).toBe(
        "voice_key_missing",
      );
      expect(reads).toEqual([]);
    });
  });
});
