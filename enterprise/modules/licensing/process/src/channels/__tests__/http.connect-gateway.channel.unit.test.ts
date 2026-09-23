/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/connect-settings.feature
 *
 * The real request and the real answer handling run; only the socket is scripted.
 */
import type { ConnectCredential } from "@langwatch/enterprise-licensing-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { HttpConnectGatewayChannel } from "../http/http.connect-gateway.channel.ts";
import { gatewayRefusal, ScriptedConnectHost } from "./support/scripted-connect-fetch.ts";

const ENDPOINT = "https://gateway.example.test";

const CREDENTIAL: ConnectCredential = {
  token: "lwl_".padEnd(68, "a"),
  instanceId: "3f1c2b40-9a7e-4f2a-8f4c-6b1f0c2d9e77",
};

const QUESTION = { id: "annoyed", kind: "boolean", instructions: "The customer sounds annoyed" };

const CLASSIFY_ANSWER = {
  verdicts: [{ questionId: "annoyed", probability: 0.82 }],
  input_tokens: 140,
  is_text_truncated: false,
  charged_usd: 0.000_01,
};

const USAGE_ANSWER = {
  services: ["instant_evals"],
  spend_available: true,
  read_at: "2026-09-19T12:00:00.000Z",
  contract: {
    id: "budget-contract",
    scope: "organization",
    window: "term",
    cap_usd: 1000,
    spent_usd: 120,
    remaining_usd: 880,
    on_breach: "block",
    period_started_at: "2026-09-01T00:00:00.000Z",
    is_contract: true,
    commit_usd: 1000,
    maximum_cap_usd: 1500,
    overage_enabled: true,
    term_ends_at: "2027-09-01T00:00:00.000Z",
  },
  budgets: [],
};

let host: ScriptedConnectHost;

function channel() {
  return HttpConnectGatewayChannel.create({ endpoint: ENDPOINT, fetch: host.fetch });
}

function classify() {
  return channel().classify({
    credential: CREDENTIAL,
    text: "the customer wrote in",
    questions: [QUESTION],
  });
}

beforeEach(() => {
  host = new ScriptedConnectHost();
});

describe("given a hosted gateway that answers", () => {
  /** @scenario "An install with the service on judges through the hosted service" */
  it("sends the license token and the instance id, and reads the verdicts back", async () => {
    host.answers(200, CLASSIFY_ANSWER);

    const answer = await classify();

    expect(host.sent).toEqual([
      expect.objectContaining({
        url: `${ENDPOINT}/v1/instant-evals/classify`,
        method: "POST",
        body: { text: "the customer wrote in", questions: [QUESTION] },
      }),
    ]);
    expect(host.sent[0]?.headers).toMatchObject({
      authorization: `Bearer ${CREDENTIAL.token}`,
      "x-langwatch-instance": CREDENTIAL.instanceId,
    });
    expect(answer).toMatchObject({
      verdicts: [{ questionId: "annoyed", probability: 0.82 }],
      inputTokens: 140,
      isTextTruncated: false,
    });
  });

  /** @scenario "Spend the hosted usage route reports is read into the settings" */
  it("reads the spend, the cap and the remaining credit under the names the app uses", async () => {
    host.answers(200, USAGE_ANSWER);

    const usage = await channel().usage({ credential: CREDENTIAL });

    expect(host.sent[0]).toMatchObject({ url: `${ENDPOINT}/v1/usage`, method: "GET" });
    expect(usage.services).toEqual(["instant_evals"]);
    expect(usage.spendAvailable).toBe(true);
    expect(usage.contract).toMatchObject({
      capUsd: 1000,
      spentUsd: 120,
      remainingUsd: 880,
      maximumCapUsd: 1500,
      periodStartedAt: "2026-09-01T00:00:00.000Z",
    });
  });

  /** @scenario "The cap an admin sets is carried to the hosted budget route" */
  it("asks the budget route for that cap and returns what it confirms", async () => {
    host.answers(200, { cap_usd: 400, maximum_cap_usd: 1500 });

    const answer = await channel().setBudget({ credential: CREDENTIAL, capUsd: 400 });

    expect(host.sent[0]).toMatchObject({
      url: `${ENDPOINT}/v1/budget`,
      method: "PUT",
      body: { cap_usd: 400 },
    });
    expect(answer).toEqual({ capUsd: 400, maximumCapUsd: 1500 });
  });
});

describe("given a hosted gateway that refuses", () => {
  /** @scenario "A spent budget surfaces as a named error" */
  it("names the cap an organization admin can raise when the budget is spent", async () => {
    host.answers(402, gatewayRefusal("budget_exceeded", { cap_usd: 1000 }));

    await expect(classify()).rejects.toMatchObject({
      code: "connect_budget_exhausted",
      fault: "customer",
      meta: { capUsd: 1000 },
    });
  });

  /** @scenario "An unregistered license surfaces as a named error" */
  it("keeps the code the host named for an unregistered license", async () => {
    host.answers(401, gatewayRefusal("connect_license_not_registered"));

    await expect(channel().usage({ credential: CREDENTIAL })).rejects.toMatchObject({
      code: "connect_license_not_registered",
    });
  });

  /** @scenario "A revoked license surfaces as a named error" */
  it("keeps the code the host named for a revoked license", async () => {
    host.answers(403, gatewayRefusal("connect_license_revoked"));

    await expect(classify()).rejects.toMatchObject({ code: "connect_license_revoked" });
  });

  /** @scenario "A license bound to another instance surfaces as a named error" */
  it("keeps the code the host named for a call from another install", async () => {
    host.answers(403, gatewayRefusal("connect_wrong_instance"));

    await expect(channel().usage({ credential: CREDENTIAL })).rejects.toMatchObject({
      code: "connect_wrong_instance",
    });
  });

  /** @scenario "A service that is not entitled surfaces as a named error" */
  it("keeps the code and the service the host named", async () => {
    host.answers(403, gatewayRefusal("connect_service_not_entitled", { service: "instant_evals" }));

    await expect(classify()).rejects.toMatchObject({
      code: "connect_service_not_entitled",
      meta: { service: "instant_evals" },
    });
  });

  /** @scenario "A cap above the contract maximum is refused with the maximum" */
  it("carries the maximum the contract allows", async () => {
    host.answers(
      400,
      gatewayRefusal("connect_budget_above_contract_maximum", { maximumUsd: 1500 }),
    );

    await expect(
      channel().setBudget({ credential: CREDENTIAL, capUsd: 9000 }),
    ).rejects.toMatchObject({
      code: "connect_budget_above_contract_maximum",
      meta: { maximumUsd: 1500 },
    });
  });

  describe("when the failure is on the LangWatch side", () => {
    /** @scenario "A failure on the LangWatch side is not blamed on the customer" */
    it("is reported as a platform fault, not a customer one", async () => {
      host.answers(500, gatewayRefusal("internal_error"));

      await expect(classify()).rejects.toMatchObject({
        code: "hosted_service_unavailable",
        fault: "platform",
      });
    });

    it("says the same when the answer is not a refusal the host wrote", async () => {
      host.answersWithAPage(502);

      await expect(classify()).rejects.toMatchObject({
        code: "hosted_service_unavailable",
        fault: "platform",
      });
    });

    it("says the same when the answer is not the published shape", async () => {
      host.answers(200, { services: "everything" });

      await expect(channel().usage({ credential: CREDENTIAL })).rejects.toMatchObject({
        code: "hosted_service_unavailable",
      });
    });
  });
});

describe("given a hosted gateway that cannot be reached", () => {
  /** @scenario "An unreachable host surfaces as a named error" */
  it("names the host and the port an outbound rule has to allow", async () => {
    host.cannotBeReached();

    await expect(classify()).rejects.toMatchObject({
      code: "connect_unreachable",
      meta: { host: "gateway.example.test", port: 443 },
    });
  });
});
