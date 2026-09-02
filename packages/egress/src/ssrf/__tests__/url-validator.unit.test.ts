import dns from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSsrfUrlValidator } from "../url-validator";

/**
 * Spec: packages/egress/specs/webhook-egress.feature
 *
 * The address rules, as literals. DNS is the one thing stubbed — the rest of
 * the decision runs for real, because what is being pinned here is which
 * ADDRESSES the policy admits, and a test that stubbed the classifier would
 * agree with any answer at all.
 */

const strict = createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] });
const permissive = createSsrfUrlValidator({ blockLocal: false, allowedHosts: [] });

function resolvesTo(records: { a?: string[]; aaaa?: string[] }) {
  vi.spyOn(dns, "resolve").mockImplementation((async (_hostname: string, recordType: string) =>
    recordType === "A" ? (records.a ?? []) : (records.aaaa ?? [])) as never);
}

afterEach(() => vi.restoreAllMocks());

describe("the SSRF address policy", () => {
  describe("given a policy that blocks local addresses", () => {
    /** @scenario "A hostname that resolves into a private range is refused" */
    it("refuses a hostname that resolves into a private range", async () => {
      resolvesTo({ a: ["10.0.5.3"] });

      await expect(strict("https://internal.example.com/hook")).rejects.toThrow(
        /resolves to a private or localhost IP/i,
      );
    });

    /** @scenario "A hostname that resolves into a private range is refused" */
    it("admits a public hostname and pins the address it resolved to", async () => {
      resolvesTo({ a: ["93.184.216.34"] });

      await expect(strict("https://example.com/hook")).resolves.toMatchObject({
        type: "resolved",
        hostname: "example.com",
        port: 443,
        protocol: "https:",
        path: "/hook",
        resolvedIp: "93.184.216.34",
      });
    });

    /** @scenario "A hostname that resolves into a private range is refused" */
    it("refuses a name it cannot resolve at all rather than connecting blind", async () => {
      resolvesTo({});

      await expect(strict("https://nowhere.example.com/hook")).rejects.toThrow(
        /Unable to resolve hostname/i,
      );
    });

    /** @scenario "A private or loopback address is refused terminally" */
    it.each([
      "127.0.0.1",
      "10.0.5.3",
      "192.168.1.1",
      "172.16.0.1",
      "0.0.0.0",
      "100.64.0.1",
      "198.18.0.1",
      "192.0.2.1",
      "224.0.0.1",
      "240.0.0.1",
    ])("refuses the IP literal %s", async (host) => {
      await expect(strict(`https://${host}/hook`)).rejects.toThrow(
        /private or localhost IP addresses is not allowed/i,
      );
    });

    /**
     * A URL's `hostname` keeps IPv6 in brackets and the IP check rejects the
     * bracketed form, so a v6 literal never reaches the classifier here — it
     * falls through to DNS and is refused as an unresolvable NAME. Still closed,
     * but with the wrong reason and the wrong retry verdict, which is exactly
     * why the webhook layer strips the brackets and refuses these terminally
     * before a send ever reaches this validator.
     */
    /** @scenario "A private or loopback address is refused terminally" */
    it.each(["::1", "fc00::1", "fe80::1", "2001:db8::1"])(
      "refuses the bracketed IPv6 literal %s, though as an unresolvable name",
      async (host) => {
        resolvesTo({});

        await expect(strict(`https://[${host}]/hook`)).rejects.toThrow(
          /Unable to resolve hostname/i,
        );
      },
    );
  });

  describe("given a policy that allows local addresses", () => {
    /** @scenario "A cloud metadata host is refused whatever the local-address policy says" */
    it.each(["169.254.169.254", "169.254.170.2", "metadata"])(
      "still refuses the metadata endpoint %s",
      async (host) => {
        await expect(permissive(`http://${host}/latest/meta-data/`)).rejects.toThrow(
          /cloud metadata endpoints is not allowed/i,
        );
      },
    );

    /**
     * The bracket gap again, and the one place it is worth naming out loud: the
     * metadata host list is matched against the URL's `hostname`, which for
     * IPv6 is bracketed, so `[fd00:ec2::254]` matches nothing on this list. The
     * strict policy still refuses it (as an unresolvable name), and every
     * customer-supplied destination refuses it terminally one layer up, where
     * the brackets are stripped. A caller that relaxes the address policy AND
     * skips the webhook layer is the only way through, and nothing does that.
     */
    /** @scenario "A cloud metadata host is refused whatever the local-address policy says" */
    it("does not match the IPv6 metadata endpoint by name while it is bracketed", async () => {
      resolvesTo({});

      await expect(permissive("http://[fd00:ec2::254]/latest/")).resolves.toMatchObject({
        type: "unresolved",
      });
      await expect(strict("http://[fd00:ec2::254]/latest/")).rejects.toThrow(
        /Unable to resolve hostname/i,
      );
    });

    /** @scenario "A cloud metadata host is refused whatever the local-address policy says" */
    it.each([
      "metadata.google.internal",
      "s3.amazonaws.com",
      "ip-10-0-0-1.eu-central-1.compute.internal",
      "receiver.local",
      "service.internal",
    ])("still refuses the cloud-internal domain %s", async (host) => {
      await expect(permissive(`https://${host}/hook`)).rejects.toThrow(
        /cloud provider internal domains is not allowed/i,
      );
    });

    /** @scenario "A hostname that resolves into a private range is refused" */
    it("admits a loopback literal, which is what relaxing the policy is for", async () => {
      await expect(permissive("http://127.0.0.1:4101/hook")).resolves.toMatchObject({
        type: "resolved",
        resolvedIp: "127.0.0.1",
        port: 4101,
      });
    });

    /** @scenario "A hostname that resolves into a private range is refused" */
    it("reports an unresolvable name rather than refusing it", async () => {
      resolvesTo({});

      await expect(permissive("http://nowhere.example.test/hook")).resolves.toMatchObject({
        type: "unresolved",
        reason: "no-records",
      });
    });
  });

  describe("given a policy that allowlists a host by name", () => {
    /** @scenario "An allowlisted host never bypasses the metadata refusal" */
    it("never lets the allowlist reach a metadata endpoint", async () => {
      const validator = createSsrfUrlValidator({
        blockLocal: true,
        allowedHosts: ["169.254.169.254"],
      });

      await expect(validator("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
        /cloud metadata endpoints is not allowed/i,
      );
    });

    /** @scenario "An allowlisted host never bypasses the metadata refusal" */
    it("does let it reach an ordinary private address, case-insensitively", async () => {
      const validator = createSsrfUrlValidator({
        blockLocal: true,
        allowedHosts: [" Internal.Example.Com "],
      });
      resolvesTo({ a: ["10.0.5.3"] });

      await expect(validator("https://internal.example.com/hook")).resolves.toMatchObject({
        type: "allowlisted",
      });
    });
  });

  describe("given a destination that is not http or https at all", () => {
    /** @scenario "Only https on the default port is admitted" */
    it("refuses the scheme before anything else is considered", async () => {
      await expect(strict("ftp://example.com/hook")).rejects.toThrow(/Unsupported protocol/i);
      await expect(strict("not a url")).rejects.toThrow(/Invalid URL format/i);
    });
  });
});
