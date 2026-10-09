/**
 * A signed-in tRPC write is accepted only from this deployment's own pages, as on the REST door.
 * Spec: packages/api/specs/browser-session-origin.feature.
 */

import { SessionReader } from "@langwatch/api/hosting";
import { composeTrpcRouters, defineTrpcRouter, TrpcHost } from "@langwatch/api/trpc";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { inertApiDoor } from "../../__tests__/support/api-door.ts";
import { composeApiApplication } from "../api-surface.ts";

interface ProfileApi {
  rename(): { renamed: boolean };
}

const ProfileApi = moduleApi<ProfileApi>()("annotation");

const router = defineTrpcRouter(
  ProfileApi,
  defineTrpcContract("profile")
    .mutation("rename")
    .withInput(z.object({}))
    .withOutput(z.object({ renamed: z.boolean() }))
    .build(),
)
  .procedure("rename")
  .noPermission({ reason: "a test namespace; no permission applies" })
  .handle(({ app }) => app.rename())
  .build();

function surface() {
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: "user_ada" }) }),
    authz: { ...inertApiDoor().authz, checkScopeLineage: async () => ({ kind: "consistent" }) },
  });
  trpc.mount(composeTrpcRouters("profile", [router]), () => ({ rename: () => ({ renamed: true }) }));

  return composeApiApplication({ trpc });
}

const write = (headers: Record<string, string>) =>
  surface().request("http://app.example/api/trpc/profile.rename", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });

describe("given a signed-in browser writing through tRPC", () => {
  it("accepts a write the browser marks same-origin", async () => {
    const response = await write({ "sec-fetch-site": "same-origin" });

    expect(response.status).toBe(200);
  });

  it.each([
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site same-site", { "sec-fetch-site": "same-site" }],
    ["a foreign Origin", { origin: "https://other.example" }],
  ])("refuses %s with cross_origin_refused", async (_, headers) => {
    const response = await write(headers);

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("cross_origin_refused");
  });
});
