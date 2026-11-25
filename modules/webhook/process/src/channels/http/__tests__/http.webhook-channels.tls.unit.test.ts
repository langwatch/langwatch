import { Response as FenceResponse } from "undici";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/egress", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchValidatedDestination: vi.fn(),
}));

import { fetchValidatedDestination, type SsrfValidationResult } from "@langwatch/egress";

import { HttpWebhookChannels } from "../http.webhook.channels.ts";

/**
 * Spec: modules/webhook/specs/webhook-egress.feature
 * Which certificate policy each send leaves with; the fence itself is stubbed.
 */

const mockedFetch = vi.mocked(fetchValidatedDestination);

const validated: SsrfValidationResult = {
  type: "resolved",
  originalUrl: "https://receiver.example/hook",
  hostname: "receiver.example",
  port: 443,
  protocol: "https:",
  path: "/hook",
  resolvedIp: "93.184.216.34",
};

function channelsOn({ isSaas }: { isSaas: boolean }) {
  return HttpWebhookChannels.create({
    config: {
      allowInsecureLocalUrls: false,
      allowAmbientAwsCredentials: false,
      isSaas,
      outboundProxy: {
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        NO_PROXY: undefined,
        no_proxy: undefined,
      },
    },
  });
}

async function verifiesCertificateWhen({
  isSaas,
  allowSelfSignedCertificate,
}: {
  isSaas: boolean;
  allowSelfSignedCertificate?: boolean;
}): Promise<boolean | undefined> {
  await channelsOn({ isSaas }).http.send({
    url: "https://receiver.example/hook",
    body: "{}",
    contextLabel: "tls test",
    validateUrl: async () => validated,
    ...(allowSelfSignedCertificate === undefined ? {} : { allowSelfSignedCertificate }),
  });
  return mockedFetch.mock.calls.at(-1)?.[2]?.rejectUnauthorized;
}

describe("given the outbound webhook HTTP channel", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedFetch.mockImplementation(async () => new FenceResponse("", { status: 200 }));
  });

  /** @scenario "A self-hosted endpoint verifies the receiver's certificate unless it opted out" */
  it("verifies the receiver's certificate on a self-hosted deployment", async () => {
    expect(await verifiesCertificateWhen({ isSaas: false })).toBe(true);
  });

  it("accepts a self-signed certificate for a self-hosted endpoint that opted in", async () => {
    expect(await verifiesCertificateWhen({ isSaas: false, allowSelfSignedCertificate: true })).toBe(
      false,
    );
  });

  /** @scenario "The hosted product verifies every receiver's certificate" */
  it("verifies every certificate on the hosted product, opt-in or not", async () => {
    expect(await verifiesCertificateWhen({ isSaas: true })).toBe(true);
    expect(await verifiesCertificateWhen({ isSaas: true, allowSelfSignedCertificate: true })).toBe(
      true,
    );
  });
});
