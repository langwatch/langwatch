// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The adapter the application hands the anomaly dispatcher: a rule's webhook
 * destination is an admin-typed URL, so it goes through the address fence and
 * a destination on a private or metadata address never gets a request.
 *
 * Only the final network call is a stand-in; the validator is the real one.
 * Spec: enterprise/modules/governance/specs/governance.feature
 */

import type * as Egress from "@langwatch/egress";
import { describe, expect, it, vi } from "vitest";

const { fetchStub } = vi.hoisted(() => ({ fetchStub: vi.fn() }));

vi.mock("@langwatch/egress", async (importOriginal) => ({
  ...(await importOriginal<typeof Egress>()),
  fetchValidatedDestination: (url: unknown, init: unknown) => fetchStub(url, init),
}));

import { HttpAnomalyAlertChannel } from "../http/http.anomaly-alert.channel.ts";

const answer = (status: number) => ({
  ok: status < 400,
  status,
  statusText: status < 400 ? "OK" : "Failed",
  headers: { get: () => null },
  body: { cancel: async () => undefined },
  json: async () => ({}),
  text: async () => "",
});

const post = ({ url }: { url: string }) =>
  HttpAnomalyAlertChannel.create().post({
    url,
    headers: { "Content-Type": "application/json" },
    body: '{"ruleId":"rule-1"}',
    signal: new AbortController().signal,
  });

describe("HttpAnomalyAlertChannel", () => {
  describe("given a webhook destination on a public address", () => {
    /** @scenario "Anomaly delivery delegates network safety" */
    it("posts the exact body through the fenced fetch and reports the answer", async () => {
      fetchStub.mockResolvedValueOnce(answer(200));

      const result = await post({ url: "https://93.184.216.34/alert" });

      expect(result).toEqual({ ok: true, status: 200, statusText: "OK" });
      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(fetchStub.mock.calls[0]?.[1]).toMatchObject({
        method: "POST",
        body: '{"ruleId":"rule-1"}',
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  describe.each([
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data"],
    ["a loopback address", "http://127.0.0.1:8080/alert"],
    ["a private network address", "http://10.0.0.5/alert"],
  ])("given a webhook destination on %s", (_name, url) => {
    /** @scenario "Anomaly delivery delegates network safety" */
    it("refuses the destination and sends nothing", async () => {
      fetchStub.mockClear();

      await expect(post({ url })).rejects.toThrow(
        /blocked|private|local|loopback|metadata|not allowed|forbidden/i,
      );

      expect(fetchStub).not.toHaveBeenCalled();
    });
  });
});
