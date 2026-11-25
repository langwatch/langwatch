// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The pullers' fenced fetch, built from the operator's egress settings as main's
 * `ssrfSafeFetch` read them. Only the final network call is a stand-in.
 * Spec: enterprise/modules/governance/specs/governance.feature
 */

import type * as Egress from "@langwatch/egress";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchStub } = vi.hoisted(() => ({ fetchStub: vi.fn() }));

vi.mock("@langwatch/egress", async (importOriginal) => ({
  ...(await importOriginal<typeof Egress>()),
  fetchValidatedDestination: () => fetchStub(),
}));

import { createSsrfSafeFetch } from "../http/http.governance-http.channel.ts";

const BLOCKED = /blocked|private|local|loopback|metadata|not allowed|forbidden/i;
const get = (fetch: ReturnType<typeof createSsrfSafeFetch>, url: string) =>
  fetch(url, { method: "GET" });

describe("the pull sources' fenced fetch", () => {
  beforeEach(() => {
    fetchStub.mockReset();
    fetchStub.mockResolvedValue({ ok: true, status: 200 });
  });

  describe("given local calls are not blocked", () => {
    const fetch = createSsrfSafeFetch({ blockLocal: false, allowedHosts: [] });

    /** @scenario "A pull source reaches the private network unless the operator blocks local calls" */
    it.each(["http://127.0.0.1:8080/events", "http://10.0.0.5/events"])(
      "fetches %s",
      async (url) => {
        await expect(get(fetch, url)).resolves.toMatchObject({ status: 200 });
        expect(fetchStub).toHaveBeenCalledTimes(1);
      },
    );

    /** @scenario "A pull source reaches the private network unless the operator blocks local calls" */
    it("still refuses the cloud metadata address", async () => {
      await expect(get(fetch, "http://169.254.169.254/latest/meta-data")).rejects.toThrow(BLOCKED);
      expect(fetchStub).not.toHaveBeenCalled();
    });
  });

  describe("given local calls are blocked", () => {
    /** @scenario "A pull source reaches the private network unless the operator blocks local calls" */
    it("refuses a loopback address", async () => {
      const fetch = createSsrfSafeFetch({ blockLocal: true, allowedHosts: [] });

      await expect(get(fetch, "http://127.0.0.1:8080/events")).rejects.toThrow(BLOCKED);
      expect(fetchStub).not.toHaveBeenCalled();
    });

    /** @scenario "A pull source reaches the private network unless the operator blocks local calls" */
    it("fetches a host the allowlist names", async () => {
      const fetch = createSsrfSafeFetch({ blockLocal: true, allowedHosts: ["127.0.0.1"] });

      await expect(get(fetch, "http://127.0.0.1:8080/events")).resolves.toMatchObject({
        status: 200,
      });
    });
  });

  describe("given a configured vendor base on a local origin", () => {
    const fetch = createSsrfSafeFetch(
      { blockLocal: true, allowedHosts: [] },
      { exemptOrigins: ["http://127.0.0.1:6970"] },
    );

    /** @scenario "Only the configured vendor base is exempt from the local-address fence" */
    it("fetches a request whose origin equals the base", async () => {
      await expect(get(fetch, "http://127.0.0.1:6970/databricks/x")).resolves.toMatchObject({
        status: 200,
      });
    });

    /** @scenario "Only the configured vendor base is exempt from the local-address fence" */
    it.each([
      "http://127.0.0.1:6971/x",
      "http://127.0.0.1/x",
      "http://10.0.0.5:6970/x",
      "https://127.0.0.1:6970/x",
    ])("still refuses the other local address %s", async (url) => {
      await expect(get(fetch, url)).rejects.toThrow(BLOCKED);
      expect(fetchStub).not.toHaveBeenCalled();
    });

    /** @scenario "Only the configured vendor base is exempt from the local-address fence" */
    it("refuses cloud metadata even when it is named as the base", async () => {
      const metadata = createSsrfSafeFetch(
        { blockLocal: true, allowedHosts: [] },
        { exemptOrigins: ["http://169.254.169.254"] },
      );
      await expect(get(metadata, "http://169.254.169.254/latest")).rejects.toThrow(BLOCKED);
    });
  });
});
