import dns from "node:dns/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { egressRefusalReason } from "../destination-refusal.ts";
import { createSsrfUrlValidator } from "../url-validator.ts";

/**
 * Spec: specs/security/ssrf-blocking.feature
 */

function resolvesTo(addresses: string[]) {
  vi.spyOn(dns, "resolve").mockImplementation((async (_hostname: string, recordType: string) =>
    recordType === "A" ? addresses : []) as never);
}

async function reasonFor({ url, blockLocal }: { url: string; blockLocal: boolean }) {
  const validate = createSsrfUrlValidator({ blockLocal, allowedHosts: [] });
  const error = await validate(url).then(
    () => undefined,
    (refusal: unknown) => refusal,
  );
  return egressRefusalReason(error);
}

afterEach(() => vi.restoreAllMocks());

describe("the address policy refusal", () => {
  /** @scenario "The address policy refusal carries the reason it was refused" */
  it.each([
    [
      "an AWS load balancer name",
      "http://abc.eu-central-1.elb.amazonaws.com/v1",
      false,
      "cloud_internal_domain",
    ],
    ["a .local name", "http://llm.corp.local/v1", false, "on_premise_domain"],
    ["a private literal under blockLocal", "http://10.0.5.3/v1", true, "private_address"],
    ["the metadata address", "http://169.254.169.254/", false, "metadata_endpoint"],
    ["a malformed URL", "not a url", false, "invalid_url"],
  ] as const)("names the reason for %s", async (_, url, blockLocal, reason) => {
    await expect(reasonFor({ url, blockLocal })).resolves.toBe(reason);
  });

  it("names a private address for a name that resolves into a private range", async () => {
    resolvesTo(["10.0.5.3"]);
    await expect(
      reasonFor({ url: "http://internal.example.com/", blockLocal: true }),
    ).resolves.toBe("private_address");
  });

  it("is not a policy refusal for an ordinary error", () => {
    expect(egressRefusalReason(new Error("socket hang up"))).toBeUndefined();
  });
});
