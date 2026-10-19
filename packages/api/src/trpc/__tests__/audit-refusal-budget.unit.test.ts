/** @vitest-environment node */

/**
 * A signed-in caller's refusals land on the audit trail within a budget, so a flood of them cannot
 * fill it. Spec: specs/audit-log/audit-log.feature.
 */

import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";

import type { RateLimiter } from "../../ports.ts";
import { trpcFailureTraceIds } from "../audit.ts";
import { createTrpcRuntimePolicy, type TrpcAuditEntry } from "../policy.ts";
import { createTrpcErrorFormatter, TrpcRootDefinition } from "../runtime.ts";

type TestContext = {
  readonly req?: { headers: Record<string, string | undefined> };
  readonly permissionChecked: boolean;
};

type Asked = { key: string; limit: { requests: number; seconds: number } | undefined };

/** A counting limiter whose capacity for any key is at most `capacity`, the injected budget. */
function limiterOf({ capacity }: { capacity: number }): RateLimiter & { asked: Asked[] } {
  const counts = new Map<string, number>();
  const asked: Asked[] = [];

  return {
    asked,
    check: async (key, limit) => {
      asked.push({ key, limit });
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);

      return { allowed: count <= Math.min(capacity, limit?.requests ?? capacity) };
    },
  };
}

const failingLimiter: RateLimiter = {
  check: () => Promise.reject(new Error("limiter unreachable")),
};

/** A policy whose one query always refuses, with the rows and warnings it produced. */
function served({ limiter }: { limiter: RateLimiter | undefined }) {
  const rows: TrpcAuditEntry[] = [];
  const warnings: { fields: unknown; message: string | undefined }[] = [];

  const root = TrpcRootDefinition.forContext<TestContext>().create({
    errorFormatter: createTrpcErrorFormatter({
      causePayload: { payloadFor: () => null },
      traceIds: trpcFailureTraceIds,
    }),
  });

  const policy = createTrpcRuntimePolicy<TestContext, TestContext>(root, {
    identity: {
      authenticate: (ctx) => ctx as TestContext,
      actor: () => ({ id: "sam" }),
    },
    audit: { record: async (entry) => void rows.push(entry) },
    errorReporting: {
      capture: () => void 0,
      asError: (value) => (value instanceof Error ? value : new Error(String(value))),
    },
    causes: { translate: () => undefined },
    refusalAudit: limiter
      ? {
          limiter,
          logger: {
            warn: (fields: unknown, message?: string) => void warnings.push({ fields, message }),
          },
        }
      : undefined,
  });

  const router = root.router({
    secret: policy.authProtectedProcedure.query(() => {
      throw new TRPCError({ code: "FORBIDDEN", message: "Not yours" });
    }),
  });

  /** One refused call through the real fetch handler. */
  const refuse = async () => {
    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: new Request("http://api.test/trpc/secret"),
      router,
      createContext: () => ({ permissionChecked: false }),
    });
    const body = (await response.json()) as { error?: { data?: { code?: string } } };

    return { status: response.status, error: body.error };
  };

  /** The same refusal, `times` times over. */
  const refuseRepeatedly = async (times: number) => {
    const answers: Awaited<ReturnType<typeof refuse>>[] = [];
    for (let attempt = 0; attempt < times; attempt++) answers.push(await refuse());

    return answers;
  };

  return { rows, warnings, refuseRepeatedly };
}

const refused = {
  status: 403,
  error: expect.objectContaining({ data: expect.objectContaining({ code: "FORBIDDEN" }) }),
};

describe("given somebody signed in who keeps provoking the same refusal", () => {
  describe("when they have done it far more times than the budget allows", () => {
    /** @scenario "One caller cannot fill the audit trail with refusals" */
    it("records the first refusals, refuses the rest exactly as before and warns once", async () => {
      const limiter = limiterOf({ capacity: 5 });
      const { rows, warnings, refuseRepeatedly } = served({ limiter });

      const answers = await refuseRepeatedly(25);

      expect(answers).toEqual(Array.from({ length: 25 }, () => refused));
      expect(answers.slice(5)).toEqual(Array.from({ length: 20 }, () => answers[0]));
      expect(rows).toHaveLength(5);
      expect(rows[0]).toMatchObject({ userId: "sam", action: "secret" });
      expect(warnings).toEqual([{ fields: { userId: "sam" }, message: expect.any(String) }]);
    });

    it("spends main's budget of 200 refusals an hour, counted per caller", async () => {
      const limiter = limiterOf({ capacity: 5 });
      const { refuseRepeatedly } = served({ limiter });

      await refuseRepeatedly(1);

      expect(limiter.asked).toEqual([
        { key: "trpc-refusal-audit:sam", limit: { requests: 200, seconds: 3600 } },
      ]);
    });
  });

  describe("when the limiter cannot be reached", () => {
    it("records every refusal and still refuses each call as before", async () => {
      const { rows, warnings, refuseRepeatedly } = served({ limiter: failingLimiter });

      const answers = await refuseRepeatedly(25);

      expect(answers).toEqual(Array.from({ length: 25 }, () => refused));
      expect(rows).toHaveLength(25);
      expect(warnings).toEqual([]);
    });
  });

  describe("when the process supplies no limiter", () => {
    it("records every refusal", async () => {
      const { rows, refuseRepeatedly } = served({ limiter: undefined });

      await refuseRepeatedly(25);

      expect(rows).toHaveLength(25);
    });
  });
});
