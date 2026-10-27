import { describe, expect, it } from "vitest";

import {
  ELEVENLABS_DEFAULT_BASE_URL,
  GatewayElevenLabsCredentialService,
} from "../gateway-elevenlabs-credential.service.ts";

function serviceStoring({
  baseUrl,
  allowLoopbackVoiceProviders,
}: {
  baseUrl: string;
  allowLoopbackVoiceProviders?: boolean;
}): GatewayElevenLabsCredentialService {
  return GatewayElevenLabsCredentialService.create({
    modelProviders: {
      getCustomKeys: async ({ modelProviderId }) => ({
        id: modelProviderId,
        provider: "elevenlabs",
        organizationId: "organization-1",
        customKeys: { ELEVENLABS_API_KEY: "xi-key", ELEVENLABS_BASE_URL: baseUrl },
      }),
    },
    allowLoopbackVoiceProviders,
  });
}

async function baseUrlFor(input: {
  baseUrl: string;
  allowLoopbackVoiceProviders?: boolean;
}): Promise<string> {
  const credential = await serviceStoring(input).getApiCredential({ modelProviderId: "p-1" });
  return credential.baseUrl;
}

describe("GatewayElevenLabsCredentialService.getApiCredential", () => {
  describe("when the dev loopback switch is off", () => {
    /** @scenario "The product reaches a loopback voice host only under the dev switch" */
    it.each(["http://127.0.0.1:5591", "http://localhost:5591", "https://127.0.0.1:5591"])(
      "swaps the loopback host %s for the vendor default",
      async (baseUrl) => {
        expect(await baseUrlFor({ baseUrl })).toBe(ELEVENLABS_DEFAULT_BASE_URL);
        expect(await baseUrlFor({ baseUrl, allowLoopbackVoiceProviders: false })).toBe(
          ELEVENLABS_DEFAULT_BASE_URL,
        );
      },
    );

    /** @scenario "The product reaches a loopback voice host only under the dev switch" */
    it("keeps a residency host on elevenlabs.io", async () => {
      expect(await baseUrlFor({ baseUrl: "https://api.eu.residency.elevenlabs.io/" })).toBe(
        "https://api.eu.residency.elevenlabs.io",
      );
    });
  });

  describe("when the dev loopback switch is on", () => {
    it("keeps a loopback stand-in with a port", async () => {
      expect(
        await baseUrlFor({ baseUrl: "http://127.0.0.1:5591", allowLoopbackVoiceProviders: true }),
      ).toBe("http://127.0.0.1:5591");
    });

    /** @scenario The dev switch never opens anything but loopback */
    it.each([
      "http://10.0.0.5:5591",
      "http://169.254.169.254:80",
      "http://169.254.169.254",
      "http://api.elevenlabs.io",
      "http://evil.example:5591",
      "http://127.0.0.1.nip.io:5591",
      "http://localtest.me:5591",
      "http://127.0.0.1",
      "http://user:pass@127.0.0.1:5591",
    ])("still swaps %s for the vendor default", async (baseUrl) => {
      expect(await baseUrlFor({ baseUrl, allowLoopbackVoiceProviders: true })).toBe(
        ELEVENLABS_DEFAULT_BASE_URL,
      );
    });
  });
});
