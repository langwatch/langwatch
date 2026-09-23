// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/hosted-services.feature
 *
 * The control-plane end of a hosted call: the gateway resolved the caller and
 * sends it beside the caller's own JSON, which never names the key or tenant.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
  type RestIdentity,
} from "@langwatch/api/rest";
import {
  ConnectServiceNotEntitledError,
  type LicensingApi,
} from "@langwatch/enterprise-licensing-contract";
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

function mount(app: Partial<LicensingApi>) {
  const hono = createRestRuntime({
    identity: gatewayDoor,
    doors: { internalSecret: gatewayDoor },
  }).mount(connectHostedRest.router(), {
    app: () => createApiFixture<LicensingApi>(app),
    onError: createCanonicalFamilyErrorHandler({
      loggerName: "langwatch:test:connect-hosted",
      label: "Hosted Connect",
    }),
  });
  return (operation: string, body: unknown) =>
    hono.fetch(
      new Request(`http://api.test/api/internal/gateway/connect/${operation}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
}

const CALLER = {
  virtual_key_id: "vk-license-acme",
  organization_id: "org-acme",
  project_id: "",
};

describe("a hosted call on the gateway's control plane", () => {
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
    });
  });

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
});
