/**
 * @vitest-environment node
 *
 * `/api/suites`, the deprecated alias that predates the split between a run
 * plan and a test suite, driven through the real Hono app.
 *
 * NONE of the spec's seven scenarios is bound here, because this branch's
 * alias no longer does any of what they claim: `suite.api.ts` carries no
 * deprecation declaration of any kind, its run body takes no `targets`, an
 * update naming targets on a test suite is accepted rather than refused, and
 * its run refusals are rendered by hand as `{ error: <sentence> }`, so the
 * refusal reaches the caller with no code at all. Those are reported as gaps
 * rather than pinned — a test asserting today's answer would make the spec
 * agree with the regression. What is left is the one thing that does hold:
 * both of the family's addresses answer the same.
 *
 * @see specs/api-reference/suites-legacy-alias.feature
 */
import { describe, expect, it } from "vitest";

import { mountSuiteFamilies } from "./support/suite-family.harness";

describe("given both addresses the alias answers on", () => {
  it("answers the bare alias identically to /api/v1", async () => {
    const { api, world } = mountSuiteFamilies();
    const plan = world.addPlan({ name: "Nightly" });

    const bare = await api.get("/api/suites");
    const versioned = await api.get("/api/v1/suites");

    expect(bare.status).toBe(200);
    expect(versioned.status).toBe(bare.status);
    const bareBody = (await bare.json()) as { id: string }[];
    expect(bareBody.map((one) => one.id)).toEqual([plan.id]);
    await expect(versioned.json()).resolves.toEqual(bareBody);
  });
});
