import { describe, expect, it } from "vitest";

import { composeApiApplication } from "../api-surface.ts";

describe("given the API surface with no route at an address", () => {
  /** @scenario "An address under the API that nothing serves answers main's not-found body" */
  it("answers 404 with main's exact not-found bytes", async () => {
    const answer = await composeApiApplication({}).request("/api/nowhere");

    expect(answer.status).toBe(404);
    await expect(answer.text()).resolves.toBe('{"error":"Not Found"}');
  });
});
