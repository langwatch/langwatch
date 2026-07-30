import { describe, expect, it } from "vitest";
import {
  assertUsableEndpoint,
  ClientSideNetworkError,
  diagnoseFetchFailure,
} from "../networkError";

const URL_ = "https://app.langwatch.ai/api/agent-onboarding/provision";

/** What `fetch` actually throws: a bare TypeError hiding the reason on cause. */
function fetchFailed(code: string): TypeError {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = Object.assign(
    new Error(`connect ${code}`),
    { code },
  );
  return err;
}

describe("naming a failed fetch", () => {
  describe("given a transport failure", () => {
    it.each([
      { code: "ENOTFOUND", expected: "network_dns_failure" },
      { code: "EAI_AGAIN", expected: "network_dns_failure" },
      { code: "ECONNREFUSED", expected: "network_connection_refused" },
      { code: "ECONNRESET", expected: "network_connection_reset" },
      { code: "ETIMEDOUT", expected: "network_timeout" },
      { code: "UND_ERR_CONNECT_TIMEOUT", expected: "network_timeout" },
      { code: "CERT_HAS_EXPIRED", expected: "network_tls_untrusted" },
      {
        code: "SELF_SIGNED_CERT_IN_CHAIN",
        expected: "network_tls_untrusted",
      },
    ])("names $code as $expected", ({ code, expected }) => {
      expect(diagnoseFetchFailure(fetchFailed(code), URL_).code).toBe(expected);
    });
  });

  describe("whatever the failure", () => {
    it("never leaves the caller with just `fetch failed`", () => {
      const diagnosed = diagnoseFetchFailure(fetchFailed("ECONNREFUSED"), URL_);

      expect(diagnosed.message).not.toBe("fetch failed");
      expect(diagnosed.headline).toContain("app.langwatch.ai");
    });

    it("blames the machine it happened on, not the platform", () => {
      // The request never landed, so no server has an opinion about it —
      // and the reader should stop checking the status page.
      const diagnosed = diagnoseFetchFailure(fetchFailed("ENOTFOUND"), URL_);

      expect(diagnosed.fault).toBe("client");
      expect(diagnosed.httpStatus).toBe(0);
      expect(diagnosed.headline).toContain("on your machine");
    });

    it("carries something the reader can act on", () => {
      const diagnosed = diagnoseFetchFailure(fetchFailed("ECONNREFUSED"), URL_);

      expect(diagnosed.tips.length).toBeGreaterThan(0);
      // The generic reporter prints only `message`, so guidance has to be in
      // it or nobody ever sees it.
      for (const tip of diagnosed.tips) {
        expect(diagnosed.message).toContain(tip);
      }
    });

    it("keeps the original error as the cause", () => {
      const original = fetchFailed("ECONNRESET");

      expect(diagnoseFetchFailure(original, URL_).cause).toBe(original);
    });
  });

  describe("given a failure with no recognisable code", () => {
    it("still says where it failed, and surfaces the underlying text", () => {
      const diagnosed = diagnoseFetchFailure(new Error("something odd"), URL_);

      expect(diagnosed.code).toBe("network_unreachable");
      expect(diagnosed.toDisplayString()).toContain("something odd");
    });
  });
});

describe("checking the endpoint before using it", () => {
  describe("given a usable endpoint", () => {
    it.each([
      "https://app.langwatch.ai",
      "http://localhost:5560",
      "https://app.feat-x.langwatch.localhost",
    ])("accepts %s", (url) => {
      expect(() => assertUsableEndpoint(url)).not.toThrow();
    });
  });

  describe("given `https:` with a single backslash", () => {
    it("accepts it — the URL parser normalises it to a working endpoint", () => {
      // Looks broken when a config value is printed verbatim, but WHATWG
      // treats backslashes as slashes for special schemes, so this really is
      // `https://app.langwatch.localhost/`. Rejecting it would break working
      // setups over a cosmetic complaint.
      expect(() =>
        assertUsableEndpoint("https:\\app.langwatch.localhost"),
      ).not.toThrow();
      expect(new URL("https:\\app.langwatch.localhost").host).toBe(
        "app.langwatch.localhost",
      );
    });
  });

  describe("given something that is not a URL at all", () => {
    it.each(["not a url", "", "app.langwatch.ai"])("refuses %s", (url) => {
      expect(() => assertUsableEndpoint(url)).toThrow(ClientSideNetworkError);
    });
  });
});
