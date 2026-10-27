import { createHash, createHmac } from "node:crypto";

import type { RestIdentity } from "@langwatch/api/hosting";
import { createCanonicalFamilyErrorHandler, createRestRuntime } from "@langwatch/api/rest";
import type { ConnectApi } from "@langwatch/enterprise-connect-contract";
import { ConnectServiceNotEntitledError } from "@langwatch/enterprise-licensing-contract";
import { GatewayInternalAuthenticationError } from "@langwatch/gateway-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/hosted-services.feature
 *
 * The control-plane end of a hosted call: the gateway resolved the caller and
 * sends it beside the caller's own JSON, which never names the key or tenant.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it, vi } from "vitest";

import { connectHostedRest } from "../connect-hosted.rest.ts";

const gatewayDoor: RestIdentity = {
  authenticate: () => {
    throw new Error("the gateway's own secret admitted the call before any route ran");
  },
  identify: () => ({
    actor: null,
    scope: null,
    internal: { type: "internalSecret" as const, secretName: "LW_GATEWAY_INTERNAL_SECRET" },
  }),
};

const SECRET = "the-deployment-gateway-secret";

/** hex(hmac_sha256(secret, METHOD\nPATH\nTS\nhex(sha256(body)))), as the Go signer and door compute it. */
function signatureOf({ path, timestamp, body }: { path: string; timestamp: string; body: string }) {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", SECRET)
    .update(`POST\n${path}\n${timestamp}\n${bodyHash}`)
    .digest("hex");
}

/** The gateway's door: admits a call only when the signature covers the bytes the runtime hands it. */
const signedDoor: RestIdentity = {
  authenticate: () => {
    throw new GatewayInternalAuthenticationError("invalid_signature", "unsigned");
  },
  identify: ({ request, rawBody }) => {
    const body = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
    const expected = signatureOf({
      path: new URL(request.url).pathname,
      timestamp: request.headers.get("X-LangWatch-Gateway-Timestamp") ?? "",
      body,
    });
    if (request.headers.get("X-LangWatch-Gateway-Signature") !== expected) {
      throw new GatewayInternalAuthenticationError("invalid_signature", "signature mismatch");
    }
    return {
      actor: null,
      scope: null,
      internal: { type: "internalSecret" as const, secretName: "LW_GATEWAY_INTERNAL_SECRET" },
    };
  },
};

function mount(app: Partial<ConnectApi>, door: RestIdentity = gatewayDoor) {
  const hono = createRestRuntime({
    audit: { record: () => {} },
    authorization: restTestAuthorization(),
    identity: door,
    doors: { internal_secret: door },
  }).mount(connectHostedRest.router(), {
    app: () => createApiFixture<ConnectApi>(app),
    onError: createCanonicalFamilyErrorHandler({
      loggerName: "langwatch:test:connect-hosted",
      label: "Hosted Connect",
    }),
  });
  return (operation: string, body: unknown, signal?: AbortSignal, signed?: string) =>
    hono.fetch(
      new Request(`http://api.test/api/internal/gateway/connect/${operation}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...gatewayHeaders(operation, signed) },
        body: typeof body === "string" ? body : JSON.stringify(body),
        signal,
      }),
    );
}

/** The headers the Go data plane sets, its signature over `signed` (none when not given). */
function gatewayHeaders(operation: string, signed: string | undefined): Record<string, string> {
  if (signed === undefined) return {};
  const timestamp = String(Math.floor(Date.now() / 1000));
  const path = `/api/internal/gateway/connect/${operation}`;
  return {
    "X-LangWatch-Gateway-Timestamp": timestamp,
    "X-LangWatch-Gateway-Signature": signatureOf({ path, timestamp, body: signed }),
  };
}

const CALLER = {
  virtual_key_id: "vk-license-acme",
  organization_id: "org-acme",
  project_id: "",
};

describe("a hosted call on the gateway's control plane", () => {
  /** @scenario A hosted judgement stops when the calling install hangs up */
  it("hands the judge the signal of the request, which aborts when the install hangs up", async () => {
    const classifyForHostedCaller = vi.fn().mockResolvedValue({
      verdicts: [],
      input_tokens: 0,
      is_text_truncated: false,
      charged_usd: 0,
    });
    const call = mount({ classifyForHostedCaller });
    const hangUp = new AbortController();

    await call(
      "instant-evals-classify",
      { ...CALLER, payload: { text: "t", questions: [] } },
      hangUp.signal,
    );

    const handed = classifyForHostedCaller.mock.calls[0]?.[0].signal;
    expect(handed.aborted).toBe(false);
    hangUp.abort();
    expect(handed.aborted).toBe(true);
  });

  it("judges under the key and organization the gateway resolved", async () => {
    const classifyForHostedCaller = vi.fn().mockResolvedValue({
      verdicts: [{ questionId: "annoyed", probability: 0.8 }],
      input_tokens: 120,
      is_text_truncated: false,
      charged_usd: 0.000_01,
    });
    const call = mount({ classifyForHostedCaller });
    const payload = { text: "the customer wrote in", questions: [] };

    const response = await call("instant-evals-classify", { ...CALLER, payload });

    expect(response.status).toBe(200);
    expect(classifyForHostedCaller).toHaveBeenCalledWith({
      caller: { virtualKeyId: "vk-license-acme", organizationId: "org-acme", projectId: null },
      payload,
      signal: expect.any(AbortSignal),
    });
  });

  /** @scenario A caller cannot name another customer's key in its request */
  it("keeps a key or organization the payload names inside the payload", async () => {
    const getHostedUsage = vi.fn().mockResolvedValue({
      services: ["instant_evals"],
      spend_available: true,
      read_at: "2026-09-19T12:00:00.000Z",
      contract: null,
      budgets: [],
    });
    const setHostedBudgetCap = vi.fn().mockResolvedValue({ cap_usd: 400, maximum_cap_usd: 1000 });
    const call = mount({ getHostedUsage, setHostedBudgetCap });
    const smuggled = {
      cap_usd: 400,
      virtual_key_id: "vk-someone-else",
      organization_id: "org-other",
    };

    await call("usage", { ...CALLER, payload: smuggled });
    await call("budget", { ...CALLER, payload: smuggled });

    const resolved = {
      virtualKeyId: "vk-license-acme",
      organizationId: "org-acme",
      projectId: null,
    };
    expect(getHostedUsage).toHaveBeenCalledWith({ caller: resolved });
    expect(setHostedBudgetCap).toHaveBeenCalledWith({ caller: resolved, payload: smuggled });
  });

  it("answers the cap the budget route set and the maximum it may reach", async () => {
    const setHostedBudgetCap = vi.fn().mockResolvedValue({ cap_usd: 400, maximum_cap_usd: 1000 });
    const call = mount({ setHostedBudgetCap });

    const response = await call("budget", { ...CALLER, payload: { cap_usd: 400 } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ cap_usd: 400, maximum_cap_usd: 1000 });
  });

  it("refuses a service outside the license by its code, judging nothing", async () => {
    const call = mount({
      classifyForHostedCaller: vi
        .fn()
        .mockRejectedValue(new ConnectServiceNotEntitledError("instant_evals")),
    });

    const response = await call("instant-evals-classify", { ...CALLER, payload: {} });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "connect_service_not_entitled" });
  });

  it("answers a call the gateway does not know without reaching any operation", async () => {
    const call = mount({});

    const response = await call("everything", { ...CALLER, payload: {} });

    expect(response.status).toBe(404);
  });

  describe("when the gateway signs the call over its body", () => {
    const usage = {
      services: ["instant_evals"],
      spend_available: true,
      read_at: "2026-09-19T12:00:00.000Z",
      contract: null,
      budgets: [],
    };
    // Go's json.Marshal of hostedServiceEnvelope: compact, in field order.
    const body = JSON.stringify({ ...CALLER, payload: { cap_usd: 400 } });

    it("admits a call whose signature covers the body it sent", async () => {
      const getHostedUsage = vi.fn().mockResolvedValue(usage);
      const call = mount({ getHostedUsage }, signedDoor);

      const response = await call("usage", body, undefined, body);

      expect(response.status).toBe(200);
      expect(getHostedUsage).toHaveBeenCalledWith({
        caller: { virtualKeyId: "vk-license-acme", organizationId: "org-acme", projectId: null },
      });
    });

    it("refuses a signature over an empty body sent beside a non-empty one", async () => {
      const getHostedUsage = vi.fn().mockResolvedValue(usage);
      const call = mount({ getHostedUsage }, signedDoor);

      const response = await call("usage", body, undefined, "");

      expect(response.status).toBe(401);
      expect(getHostedUsage).not.toHaveBeenCalled();
    });

    it("refuses a signed envelope that names no caller, reaching no operation", async () => {
      const getHostedUsage = vi.fn().mockResolvedValue(usage);
      const call = mount({ getHostedUsage }, signedDoor);
      const nameless = JSON.stringify({ payload: {} });

      const response = await call("usage", nameless, undefined, nameless);

      expect(response.status).toBe(422);
      expect(getHostedUsage).not.toHaveBeenCalled();
    });
  });
});
