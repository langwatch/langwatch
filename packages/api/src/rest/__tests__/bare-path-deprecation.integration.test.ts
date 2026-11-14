/**
 * A dated family that declares its bare `/api` path deprecated answers there as at its `/api/v1`
 * twin, and says so on every bare answer. Spec: packages/api/specs/versioned-routing.feature.
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { publicRoute } from "../../access/access.ts";
import { createErrorHandler } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

const VERSION = "2026-09-08";

type ThingApi = Readonly<{ read(input: { id: string }): { id: string } }>;

const ThingApi = moduleApi<ThingApi>()("annotation");

function thingsApp() {
  const declaration = defineRestRouter(ThingApi)
    .withNamespace("things")
    .withVersion(VERSION)
    .withAddressing("dated", { bareDeprecated: true })
    .get("/:thingId", "getThing")
    .withAccess(publicRoute({ reason: "the test reads nothing private" }))
    .withParams(z.object({ thingId: z.string() }))
    .withOutput(z.object({ id: z.string() }))
    .handle(({ app, input }) => app.read({ id: input.thingId }))
    .build()
    .router();

  return createRestRuntime({
    authorization: authorizationPort,
    identity: { authenticate: () => ({ actor: null, scope: null }) },
  }).mount(declaration, {
    app: () => ({ read: ({ id }: { id: string }) => ({ id }) }),
    credential: "project",
    onError: createErrorHandler(),
  });
}

const ADDRESSES = ["/thing-1", `/${VERSION}/thing-1`, "/latest/thing-1", "/2027-01-01/thing-1"];

async function answerAt(path: string) {
  const response = await thingsApp().request(path);

  return {
    status: response.status,
    body: await response.text(),
    deprecation: response.headers.get("Deprecation"),
    link: response.headers.get("Link"),
  };
}

describe("given a dated family that declares its bare /api path deprecated", () => {
  /** @scenario "A family can deprecate its bare path in favour of its /api/v1 twin" */
  it("answers each bare address as its /api/v1 twin, naming the twin as successor", async () => {
    const bare = await Promise.all(ADDRESSES.map((rest) => answerAt(`/api/things${rest}`)));
    const twin = await Promise.all(ADDRESSES.map((rest) => answerAt(`/api/v1/things${rest}`)));

    expect(bare.map(({ status, body }) => ({ status, body }))).toEqual(
      twin.map(({ status, body }) => ({ status, body })),
    );
    expect(bare.map(({ status }) => status)).toEqual(ADDRESSES.map(() => 200));
    expect(bare.map(({ deprecation, link }) => ({ deprecation, link }))).toEqual(
      ADDRESSES.map(() => ({
        deprecation: "true",
        link: '</api/v1/things>; rel="successor-version"',
      })),
    );
  });

  /** @scenario "A family can deprecate its bare path in favour of its /api/v1 twin" */
  it("carries no deprecation header on any /api/v1 answer", async () => {
    const twin = await Promise.all(ADDRESSES.map((rest) => answerAt(`/api/v1/things${rest}`)));

    expect(twin.map(({ deprecation, link }) => ({ deprecation, link }))).toEqual(
      ADDRESSES.map(() => ({ deprecation: null, link: null })),
    );
  });

  /** @scenario "A family can deprecate its bare path in favour of its /api/v1 twin" */
  it("refuses the declaration on a family with no /api/v1 twin", () => {
    const router = () => defineRestRouter(ThingApi).withNamespace("things").withVersion(VERSION);

    expect(() => router().withAddressing("dated", { v1Twin: false, bareDeprecated: true })).toThrow(
      /bare/,
    );
    expect(() => router().withAddressing("v1-only", { bareDeprecated: true })).toThrow(/bare/);
    expect(() =>
      router().withAddressing("literal", { v1Twin: false, bareDeprecated: true }),
    ).toThrow(/bare/);
  });
});
