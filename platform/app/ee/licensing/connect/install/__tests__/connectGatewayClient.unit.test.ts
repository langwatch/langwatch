/**
 * The install's transport to hosted services: what it sends, what it reads
 * back, and what each refusal becomes.
 *
 * Driven through undici's `MockAgent` as the dispatcher, so the real request
 * is built and the real response handling runs, and only the socket is
 * replaced.
 *
 * @see ../connectGatewayClient.ts
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import { Agent, EnvHttpProxyAgent, MockAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InstantEvalQuestion } from "~/server/app-layer/instant-evals/classifier/classifier";
import {
  type ConnectCredential,
  ConnectGatewayClient,
  createConnectDispatcher,
} from "../connectGatewayClient";

const ENDPOINT = "https://gateway.example.test";

const CREDENTIAL: ConnectCredential = {
  token: "lwl_".padEnd(68, "a"),
  instanceId: "organization-of-record",
};

const QUESTION: InstantEvalQuestion = {
  id: "annoyed",
  kind: "boolean",
  instructions: "The customer sounds annoyed",
};

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

function refusal(code: string, meta?: Record<string, unknown>) {
  return {
    error: {
      type: code,
      code,
      message: `the host refused with ${code}`,
      ...(meta ? { meta } : {}),
    },
  };
}

let agent: MockAgent;

function client() {
  return new ConnectGatewayClient({ endpoint: ENDPOINT, dispatcher: agent });
}

function host() {
  return agent.get(ENDPOINT);
}

function classify() {
  return client().classify({
    credential: CREDENTIAL,
    text: "the customer wrote in",
    questions: [QUESTION],
  });
}

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});

afterEach(async () => {
  await agent.close();
});

describe("given a host that answers", () => {
  describe("when a text is judged", () => {
    /** @scenario "An install with the service on judges through the hosted service" */
    it("sends the license token and the instance id, and reads the verdicts back", async () => {
      let sentHeaders: Record<string, string> = {};
      let sentBody = "";
      host()
        .intercept({ path: "/v1/instant-evals/classify", method: "POST" })
        .reply(200, (options) => {
          sentHeaders = options.headers as Record<string, string>;
          sentBody = String(options.body);
          return CLASSIFY_ANSWER;
        });

      const answer = await classify();

      expect(sentHeaders.authorization).toBe(`Bearer ${CREDENTIAL.token}`);
      expect(sentHeaders["x-langwatch-instance"]).toBe(CREDENTIAL.instanceId);
      expect(JSON.parse(sentBody)).toEqual({
        text: "the customer wrote in",
        questions: [QUESTION],
      });
      expect(answer.verdicts).toEqual([
        { questionId: "annoyed", probability: 0.82 },
      ]);
      expect(answer.inputTokens).toBe(140);
      expect(answer.isTextTruncated).toBe(false);
    });
  });

  describe("when usage is read", () => {
    /** @scenario "Spend the hosted usage route reports is read into the settings" */
    it("reads the spend, the cap and the remaining credit under the names the app uses", async () => {
      host()
        .intercept({ path: "/v1/usage", method: "GET" })
        .reply(200, USAGE_ANSWER);

      const usage = await client().usage({ credential: CREDENTIAL });

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
  });

  describe("when a cap is set", () => {
    /** @scenario "The cap an admin sets is carried to the hosted budget route" */
    it("asks the budget route for that cap and returns what it confirms", async () => {
      let sentBody = "";
      host()
        .intercept({ path: "/v1/budget", method: "PUT" })
        .reply(200, (options) => {
          sentBody = String(options.body);
          return { cap_usd: 400, maximum_cap_usd: 1500 };
        });

      const answer = await client().setBudget({
        credential: CREDENTIAL,
        capUsd: 400,
      });

      expect(JSON.parse(sentBody)).toEqual({ cap_usd: 400 });
      expect(answer).toEqual({ capUsd: 400, maximumCapUsd: 1500 });
    });
  });
});

describe("given a host that refuses", () => {
  describe("when the budget behind the call is spent", () => {
    /** @scenario "A spent budget surfaces as a named error" */
    it("fails with a code naming the cap an organization admin can raise", async () => {
      host()
        .intercept({ path: "/v1/instant-evals/classify", method: "POST" })
        .reply(402, refusal("budget_exceeded", { cap_usd: 1000 }));

      await expect(classify()).rejects.toMatchObject({
        code: "connect_budget_exhausted",
        fault: "customer",
        meta: { capUsd: 1000 },
      });
    });
  });

  describe("when the license is not registered", () => {
    /** @scenario "An unregistered license surfaces as a named error" */
    it("keeps the code the host named", async () => {
      host()
        .intercept({ path: "/v1/usage", method: "GET" })
        .reply(401, refusal("connect_license_not_registered"));

      await expect(
        client().usage({ credential: CREDENTIAL }),
      ).rejects.toMatchObject({ code: "connect_license_not_registered" });
    });
  });

  describe("when the license has been revoked", () => {
    /** @scenario "A revoked license surfaces as a named error" */
    it("keeps the code the host named", async () => {
      host()
        .intercept({ path: "/v1/instant-evals/classify", method: "POST" })
        .reply(403, refusal("connect_license_revoked"));

      await expect(classify()).rejects.toMatchObject({
        code: "connect_license_revoked",
      });
    });
  });

  describe("when the call comes from another install", () => {
    /** @scenario "A license bound to another instance surfaces as a named error" */
    it("keeps the code the host named", async () => {
      host()
        .intercept({ path: "/v1/usage", method: "GET" })
        .reply(403, refusal("connect_wrong_instance"));

      await expect(
        client().usage({ credential: CREDENTIAL }),
      ).rejects.toMatchObject({ code: "connect_wrong_instance" });
    });
  });

  describe("when the license does not include the service", () => {
    /** @scenario "A service that is not entitled surfaces as a named error" */
    it("keeps the code and the service the host named", async () => {
      host()
        .intercept({ path: "/v1/instant-evals/classify", method: "POST" })
        .reply(
          403,
          refusal("connect_service_not_entitled", { service: "instant_evals" }),
        );

      await expect(classify()).rejects.toMatchObject({
        code: "connect_service_not_entitled",
        meta: { service: "instant_evals" },
      });
    });
  });

  describe("when the cap asked for is above the contract maximum", () => {
    /** @scenario "A cap above the contract maximum is refused with the maximum" */
    it("carries the maximum the contract allows", async () => {
      host()
        .intercept({ path: "/v1/budget", method: "PUT" })
        .reply(
          400,
          refusal("connect_budget_above_contract_maximum", {
            maximumUsd: 1500,
          }),
        );

      await expect(
        client().setBudget({ credential: CREDENTIAL, capUsd: 9000 }),
      ).rejects.toMatchObject({
        code: "connect_budget_above_contract_maximum",
        meta: { maximumUsd: 1500 },
      });
    });
  });

  describe("when the failure is on the LangWatch side", () => {
    /** @scenario "A failure on the LangWatch side is not blamed on the customer" */
    it("is reported as a platform fault, not a customer one", async () => {
      host()
        .intercept({ path: "/v1/instant-evals/classify", method: "POST" })
        .reply(500, refusal("internal_error"));

      await expect(classify()).rejects.toMatchObject({
        code: "hosted_service_unavailable",
        fault: "platform",
      });
    });

    it("says the same when the answer is not a refusal the host wrote", async () => {
      host()
        .intercept({ path: "/v1/instant-evals/classify", method: "POST" })
        .reply(502, "<html>gateway timeout</html>");

      await expect(classify()).rejects.toMatchObject({
        code: "hosted_service_unavailable",
        fault: "platform",
      });
    });

    it("says the same when the answer is not the published shape", async () => {
      host()
        .intercept({ path: "/v1/usage", method: "GET" })
        .reply(200, { services: "everything" });

      await expect(
        client().usage({ credential: CREDENTIAL }),
      ).rejects.toMatchObject({ code: "hosted_service_unavailable" });
    });
  });
});

describe("given a host that cannot be reached", () => {
  describe("when a text is judged", () => {
    /** @scenario "An unreachable host surfaces as a named error" */
    it("names the host and the port an outbound rule has to allow", async () => {
      host()
        .intercept({ path: "/v1/instant-evals/classify", method: "POST" })
        .replyWithError(new Error("ECONNREFUSED"));

      await expect(classify()).rejects.toMatchObject({
        code: "connect_unreachable",
        meta: { host: "gateway.example.test", port: 443 },
      });
    });
  });
});

describe("given a deployment that sends outbound traffic through a proxy", () => {
  describe("when the dispatcher is built", () => {
    /** @scenario "Hosted calls go through the configured outbound proxy" */
    it("uses the proxy the environment names", async () => {
      const dispatcher = createConnectDispatcher({
        HTTPS_PROXY: "http://proxy.example.test:3128",
      });

      expect(dispatcher).toBeInstanceOf(EnvHttpProxyAgent);
      await dispatcher.close();
    });

    it("uses a plain connection when no proxy is named", async () => {
      const dispatcher = createConnectDispatcher({});

      expect(dispatcher).toBeInstanceOf(Agent);
      expect(dispatcher).not.toBeInstanceOf(EnvHttpProxyAgent);
      await dispatcher.close();
    });
  });
});
