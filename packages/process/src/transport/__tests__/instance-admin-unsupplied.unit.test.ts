/**
 * Spec: specs/server/typed-process-supply.feature,
 * "a credential the deployment supplies is named, not spelled".
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

describe("given a process that supplies no instance administrator bearer", () => {
  /** @scenario "A door whose credential was never supplied refuses callers" */
  it("refuses a caller presenting one, while the route it guards stays mounted", async () => {
    const provision = vi.fn(async () => ({ id: "organization-1" }));
    const app = createRestRuntime({
      identity: instanceAdminDoor({ token: void 0, isSaas: false }),
    }).mount(provisioning.router(), { app: () => ({ provision }), onError: createErrorHandler() });
    const post = (path: string) =>
      app.request(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer instance-admin-key-0000000000000000",
        },
        body: JSON.stringify({ name: "Acme" }),
      });

    const refused = await post("/api/organizations");
    const unrouted = await post("/api/organisations");

    expect(refused.status).toBe(404);
    await expect(refused.json()).resolves.toMatchObject({ code: "not_found" });
    expect(provision).not.toHaveBeenCalled();
    // The door's refusal, not the router's: a path nothing mounted answers bare.
    expect(await unrouted.text()).toBe("404 Not Found");
  });
});
