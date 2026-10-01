/**
 * The instance-admin family exists only where its key is set and the deployment is not SaaS;
 * elsewhere it answers 404 before any credential is looked at, as main's verifyInstanceAdminKey
 * did.
 */
import { createErrorHandler } from "@langwatch/api";
import { anyAuthenticated } from "@langwatch/api/access";
import { createRestRuntime, defineRestRouter } from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { instanceAdminDoor } from "../api-surface.ts";

interface ProvisioningApi {
  provision(input: { name: string }): Promise<{ id: string }>;
}

const ProvisioningApi = moduleApi<ProvisioningApi>()("organization");

const provisioning = defineRestRouter(ProvisioningApi)
  .withNamespace("organizations")
  .withVersion("2025-01-01")
  .withCredential("instance_admin")
  .withAddressing("literal")
  .post("/api/organizations", "provision")
  .withInput(z.object({ name: z.string().min(1) }))
  .withAccess(anyAuthenticated({ reason: "the instance administrator key is the whole gate" }))
  .withOutput(z.object({ id: z.string() }))
  .handle(({ app, input }) => app.provision(input))
  .build();

const KEY = "instance-admin-key-0000000000000000";

function send({
  token,
  isSaas,
  authorization,
  name = "",
}: {
  token: string | undefined;
  isSaas: boolean;
  authorization?: string;
  name?: string;
}) {
  const provision = vi.fn(async () => ({ id: "organization-1" }));
  const app = createRestRuntime({ identity: instanceAdminDoor({ token, isSaas }) }).mount(
    provisioning.router(),
    { app: () => ({ provision }), onError: createErrorHandler() },
  );
  const response = app.request("/api/organizations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify({ name }),
  });

  return { response, provision };
}

describe("the instance-admin family", () => {
  describe("given no key is set", () => {
    it("answers 404 to a caller presenting nothing, before the body is validated", async () => {
      const { response, provision } = send({ token: void 0, isSaas: false });
      const answer = await response;

      expect(answer.status).toBe(404);
      await expect(answer.json()).resolves.toMatchObject({ code: "not_found" });
      expect(provision).not.toHaveBeenCalled();
    });
  });

  describe("given a SaaS deployment", () => {
    it("answers 404 even to the configured key", async () => {
      const { response, provision } = send({
        token: KEY,
        isSaas: true,
        authorization: `Bearer ${KEY}`,
      });

      expect((await response).status).toBe(404);
      expect(provision).not.toHaveBeenCalled();
    });
  });

  describe("given the key is set on a self-hosted deployment", () => {
    it("refuses a wrong bearer as unauthenticated", async () => {
      const { response } = send({ token: KEY, isSaas: false, authorization: "Bearer wrong" });

      expect((await response).status).toBe(401);
    });

    it("hands the configured key to the handler", async () => {
      const { response, provision } = send({
        token: KEY,
        isSaas: false,
        authorization: `Bearer ${KEY}`,
        name: "Acme",
      });

      expect((await response).status).toBe(200);
      expect(provision).toHaveBeenCalledWith({ name: "Acme" });
    });
  });
});
