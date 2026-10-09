/**
 * A REST route declared with the builder reaches the registry as serving while upgrading, and a
 * literal route beneath a declared wildcard stays held unless it declares it too (UIW-6).
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { publicRoute } from "../../access/access.ts";
import { routesServingWhileUpgrading } from "../../route-registry.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";

const Api = moduleApi<{ answer(): { ok: boolean } }>()("project");
const OPEN = publicRoute({ reason: "the upgrading-mode fixture" });
const ANSWER = z.object({ ok: z.boolean() });

const declaration = defineRestRouter(Api)
  .withNamespace("upgrading-fixture")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .get("/api/upgrading-fixture/held", "held")
  .withAccess(OPEN)
  .withOutput(ANSWER)
  .handle(({ app }) => app.answer())
  .get("/api/upgrading-fixture/declared", "declared")
  .withAccess(OPEN)
  .servesWhileUpgrading()
  .withOutput(ANSWER)
  .handle(({ app }) => app.answer())
  .get("/api/upgrading-fixture/*", "rest")
  .withAccess(OPEN)
  .servesWhileUpgrading()
  .withOutput(ANSWER)
  .handle(({ app }) => app.answer())
  .build();

function mounted(): (route: string) => boolean {
  const closed = BearerIdentity.create({ name: "unconfigured", token: void 0 });
  RestHost.create({
    identities: {
      project: closed,
      organization: closed,
      api_key: closed,
      scim_token: closed,
      instance_admin: closed,
      browser: closed,
    },
    bearers: () => closed,
    audit: { record: async () => {} },
  }).mount(declaration.router(), () => ({ answer: () => ({ ok: true }) }));
  const patterns = routesServingWhileUpgrading().map((source) => new RegExp(source));

  return (route) => patterns.some((pattern) => pattern.test(route));
}

describe("given REST routes declared with the builder and mounted on a host", () => {
  /** @scenario "Upgrading mode serves only the routes declared to serve while upgrading" */
  it("passes the declared literal and the wildcard, and holds the undeclared literal beneath it", () => {
    const passes = mounted();

    expect(passes("GET /api/upgrading-fixture/declared")).toBe(true);
    expect(passes("GET /api/upgrading-fixture/anything/else")).toBe(true);
    expect(passes("GET /api/upgrading-fixture/held")).toBe(false);
    expect(passes("POST /api/upgrading-fixture/declared")).toBe(false);
  });
});
