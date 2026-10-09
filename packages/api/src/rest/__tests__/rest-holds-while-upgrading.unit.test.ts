/**
 * A REST route serves while upgrading unless the builder holds it; a literal route beneath a held
 * wildcard still serves unless it holds too (API-UP).
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { publicRoute } from "../../access/access.ts";
import { routesHeldWhileUpgrading } from "../../route-registry.ts";
import { MANAGEMENT_API_VERSION } from "../addressing.ts";
import { BearerIdentity } from "../bearer-identity.ts";
import { defineRestRouter } from "../declaration.ts";
import { RestHost } from "../host.ts";

const Api = moduleApi<{ answer(): { ok: boolean } }>()("project");
const OPEN = publicRoute({ reason: "the upgrading-mode fixture" });
const HOLD = { because: "the fixture races the upgrade" };
const ANSWER = z.object({ ok: z.boolean() });

const declaration = defineRestRouter(Api)
  .withNamespace("upgrading-fixture")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .get("/api/upgrading-fixture/serving", "serving")
  .withAccess(OPEN)
  .withOutput(ANSWER)
  .handle(({ app }) => app.answer())
  .get("/api/upgrading-fixture/held", "held")
  .withAccess(OPEN)
  .holdsWhileUpgrading(HOLD)
  .withOutput(ANSWER)
  .handle(({ app }) => app.answer())
  .get("/api/upgrading-fixture/*", "rest")
  .withAccess(OPEN)
  .holdsWhileUpgrading(HOLD)
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
  const patterns = routesHeldWhileUpgrading().map((source) => new RegExp(source));

  return (route) => !patterns.some((pattern) => pattern.test(route));
}

describe("given REST routes declared with the builder and mounted on a host", () => {
  /** @scenario "Every route serves while upgrading unless it holds, naming why" */
  it("serves the literal beneath the held wildcard and holds the held literal and the wildcard", () => {
    const serves = mounted();

    expect(serves("GET /api/upgrading-fixture/serving")).toBe(true);
    expect(serves("GET /api/upgrading-fixture/held")).toBe(false);
    expect(serves("GET /api/upgrading-fixture/anything/else")).toBe(false);
    expect(serves("GET /api/other-fixture")).toBe(true);
  });

  it("refuses a hold that names no reason", () => {
    expect(() =>
      defineRestRouter(Api)
        .withNamespace("upgrading-blank")
        .withVersion(MANAGEMENT_API_VERSION)
        .withAddressing("literal", { v1Twin: false })
        .get("/api/upgrading-blank", "blank")
        .holdsWhileUpgrading({ because: "" }),
    ).toThrow(/without saying why/);
  });
});
