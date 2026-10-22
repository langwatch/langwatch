/**
 * The REST runtime counts a key's reads against that key and refuses past its allowance.
 * @see specs/security/read-rate-limits.feature
 */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { createErrorHandler } from "../../errors.ts";
import type { RateLimiter } from "../../ports.ts";
import { recordProjectCredential } from "../../rest/credential.ts";
import { defineRestRouter } from "../../rest/declaration.ts";
import { createRestRuntime } from "../../rest/runtime.ts";
import { ReadBudget, type ReadBudgetLimits } from "../read-budget.ts";

interface ListingApi {
  list(): Promise<{ rows: { id: number }[] }>;
}
const ListingApi = moduleApi<ListingApi>()("evaluator");

const listing = defineRestRouter(ListingApi)
  .withNamespace("listing")
  .withVersion("2026-09-08")
  .withAddressing("v1-only")
  .get("/", "listRows")
  .withPermission("evaluations:view")
  .withOutput(z.object({ rows: z.object({ id: z.number() }).array() }))
  .handle(async ({ app }) => app.list())
  .build();

const LIMITS: ReadBudgetLimits = {
  readsPerMinute: 1,
  rowsPerHour: 1_000,
  rowsPerDay: 5_000,
  exportsPerMinute: 1,
  exportsPerDay: 1,
  impersonationReadsPerMinute: 1,
  impersonationRowsPerDay: 1,
};

function listingApp({ enforced }: { enforced: boolean }) {
  const used = new Map<string, number>();
  const counter: RateLimiter = {
    check: async (key, limit, cost = 1) => {
      const total = (used.get(key) ?? 0) + cost;
      used.set(key, total);
      return total <= (limit?.requests ?? Infinity)
        ? { allowed: true, used: total }
        : { allowed: false, used: total, retryAfterSeconds: 42 };
    },
  };
  const quiet = () => undefined;
  const runtime = createRestRuntime({
    authorization: authorizationPort,
    identity: {
      authenticate: ({ request }) => {
        recordProjectCredential(request, {
          type: "apiKey",
          apiKeyId: request.headers.get("x-key") ?? "key-a",
          userId: "user-1",
          organizationId: "org-1",
          ingestionTemplateId: null,
          project: { id: "project-1", slug: "project-1" },
        } as never);
        return { actor: { type: "user", id: "user-1" }, scope: { tier: "project", id: "project-1" } };
      },
    },
    readBudget: ReadBudget.create({
      counter,
      limitsFor: async () => ({ limits: LIMITS, organizationId: "org-1" }),
      enforced: async () => enforced,
      logger: { info: quiet, warn: quiet, error: quiet },
    }),
  });
  const app = runtime.mount(listing.router(), {
    app: () => ({ list: async () => ({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }) }),
    onError: createErrorHandler(),
  });
  return { app, used };
}

describe("a REST read behind the read budget", () => {
  describe("when one API key reads past its minute with enforcement on", () => {
    it("answers 429 with Retry-After and counts the rows of the answered read", async () => {
      const { app, used } = listingApp({ enforced: true });

      const first = await app.request("/api/v1/listing");
      const second = await app.request("/api/v1/listing");
      const otherKey = await app.request("/api/v1/listing", { headers: { "x-key": "key-b" } });

      expect(first.status).toBe(200);
      expect(second.status).toBe(429);
      expect(second.headers.get("Retry-After")).toBe("42");
      expect(((await second.json()) as { code?: string }).code).toBe("read_rate_limited");
      expect(otherKey.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(used.get("read-budget:api_key:key-a:rows-hour")).toBe(3);
    });
  });

  describe("when enforcement is off", () => {
    it("answers the read past the allowance", async () => {
      const { app } = listingApp({ enforced: false });

      await app.request("/api/v1/listing");

      expect((await app.request("/api/v1/listing")).status).toBe(200);
    });
  });
});
