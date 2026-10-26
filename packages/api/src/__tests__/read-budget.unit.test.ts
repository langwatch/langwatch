import { explainHandledError } from "@langwatch/handled-error/presentation";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
/**
 * The per-credential read budget: admission before a read, rows counted after it.
 * @see specs/security/read-rate-limits.feature
 */
import { describe, expect, it } from "vitest";

import { ReadRateLimitedError } from "../errors.ts";
import type { RateLimiter } from "../ports.ts";
import {
  READ_RATE_LIMIT_EXCEEDED_EVENT,
  ReadBudget,
  type ReadBudgetLimits,
  type ReadCall,
  type ReadCredential,
  readKindOf,
  rowsOf,
} from "../read-budget.ts";

const LIMITS: ReadBudgetLimits = {
  readsPerMinute: 3,
  rowsPerHour: 1_000,
  rowsPerDay: 5_000,
  exportsPerMinute: 1,
  exportsPerDay: 10,
  impersonationReadsPerMinute: 2,
  impersonationRowsPerDay: 100,
};

const KEY_A: ReadCredential = { id: "key-a", type: "api_key" };
const KEY_B: ReadCredential = { id: "key-b", type: "api_key" };
const SESSION: ReadCredential = { id: "user-1", type: "session" };
const OPERATOR: ReadCredential = {
  id: "operator-1",
  type: "impersonation",
  impersonatorId: "operator-1",
  subjectUserId: "user-1",
};
const SCOPE = { tier: "project", id: "project-1" } as const;

/** A fixed-window counter with no clock: every window stays open for the test. */
function memoryCounter(): RateLimiter & { used: Map<string, number> } {
  const used = new Map<string, number>();
  return {
    used,
    check(key, limit, cost = 1) {
      const total = (used.get(key) ?? 0) + cost;
      used.set(key, total);
      const allowance = limit?.requests ?? Number.MAX_SAFE_INTEGER;
      return Promise.resolve(
        total <= allowance
          ? { allowed: true, used: total }
          : { allowed: false, used: total, retryAfterSeconds: limit?.seconds ?? 1 },
      );
    },
  };
}

function failingCounter(): RateLimiter {
  return { check: () => Promise.reject(new Error("connection refused")) };
}

type Line = { level: string; fields: Record<string, unknown>; message: string };

function recordingLogger() {
  const lines: Line[] = [];
  const at =
    (level: string) =>
    (fields: Record<string, unknown>, message: string): void => {
      lines.push({ level, fields, message });
    };
  return { logger: { info: at("info"), warn: at("warn"), error: at("error") }, lines };
}

function budgetWith({
  enforced,
  counter = memoryCounter(),
  organizationOf = () => "org-1",
}: {
  enforced: boolean;
  counter?: RateLimiter;
  organizationOf?: (scope: ReadCall["scope"]) => string | null;
}) {
  const { logger, lines } = recordingLogger();
  const budget = ReadBudget.create({
    counter,
    limitsFor: ({ scope }) =>
      Promise.resolve({ limits: LIMITS, organizationId: organizationOf(scope) }),
    enforced: () => Promise.resolve(enforced),
    logger,
  });
  const exceeded = () =>
    lines.filter((line) => line.fields.event === READ_RATE_LIMIT_EXCEEDED_EVENT);
  return { budget, lines, exceeded };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function readBy(
  credential: ReadCredential,
  kind: "read" | "export" = "read",
  scope: ReadCall["scope"] = SCOPE,
) {
  return { credential, kind, route: "traces.searchTraces", scope } as const;
}

describe("ReadBudget", () => {
  describe("given an API key under its minute's allowance", () => {
    /** @scenario "A read under its allowance is answered" */
    it("admits the read and logs nothing", async () => {
      const { budget, lines } = budgetWith({ enforced: true });

      await budget.admit(readBy(KEY_A));

      expect(lines).toEqual([]);
    });
  });

  describe("given one key on a project has spent its minute", () => {
    /** @scenario "Two keys on one project have separate budgets" */
    it("admits a second key on the same project", async () => {
      const { budget } = budgetWith({ enforced: true });
      for (let call = 0; call < LIMITS.readsPerMinute; call += 1) {
        await budget.admit(readBy(KEY_A));
      }

      expect(await codeOf(budget.admit(readBy(KEY_B)))).toBeUndefined();
      expect(await codeOf(budget.admit(readBy(KEY_A)))).toBe("read_rate_limited");
    });
  });

  describe("given a person who belongs to two organizations", () => {
    const ORG_ONE_PROJECT = { tier: "project", id: "project-1" } as const;
    const ORG_TWO_PROJECT = { tier: "project", id: "project-2" } as const;
    const organizationOf = (scope: ReadCall["scope"]) =>
      scope?.id === ORG_TWO_PROJECT.id ? "org-2" : "org-1";

    /** @scenario "A person in two organizations has a separate budget in each" */
    it("admits a read in the second organization once the first's minute is spent", async () => {
      const { budget } = budgetWith({ enforced: true, organizationOf });
      for (let call = 0; call < LIMITS.readsPerMinute; call += 1) {
        await budget.admit(readBy(SESSION, "read", ORG_ONE_PROJECT));
      }

      expect(await codeOf(budget.admit(readBy(SESSION, "read", ORG_TWO_PROJECT)))).toBeUndefined();
      expect(await codeOf(budget.admit(readBy(SESSION, "read", ORG_ONE_PROJECT)))).toBe(
        "read_rate_limited",
      );
    });

    /** @scenario "A key's budget does not split by the organization a call names" */
    it("keeps one window for a key bound to its own organization", async () => {
      const counter = memoryCounter();
      const { budget } = budgetWith({ enforced: true, counter, organizationOf });

      await budget.admit(readBy(KEY_A, "read", ORG_ONE_PROJECT));
      await budget.admit(readBy(KEY_A, "read", ORG_TWO_PROJECT));

      expect(counter.used.get("read-budget:api_key:key-a:reads-minute")).toBe(2);
    });
  });

  describe("when a key past its minute reads again", () => {
    /** @scenario "A read past the minute's allowance is refused when enforcement is on" */
    it("refuses with the wait and logs the credential, route and volume", async () => {
      const { budget, exceeded } = budgetWith({ enforced: true });
      for (let call = 0; call < LIMITS.readsPerMinute; call += 1) {
        await budget.admit(readBy(KEY_A));
      }

      let refusal: { code?: string; meta?: Record<string, unknown> } | undefined;
      try {
        await budget.admit(readBy(KEY_A));
      } catch (error) {
        refusal = error as typeof refusal;
      }

      expect(refusal?.code).toBe("read_rate_limited");
      expect(refusal?.meta?.retryAfterMs).toBe(60_000);
      expect(exceeded()[0]?.fields).toMatchObject({
        credentialId: "key-a",
        credentialType: "api_key",
        route: "traces.searchTraces",
        kind: "read",
        dimension: "reads_per_minute",
        limit: LIMITS.readsPerMinute,
        observed: LIMITS.readsPerMinute + 1,
        windowSeconds: 60,
        retryAfterSeconds: 60,
        enforced: true,
        projectId: "project-1",
        organizationId: "org-1",
      });
    });

    /** @scenario "A read past its allowance is only logged while enforcement is off" */
    it("admits it while enforcement is off and marks the event not enforced", async () => {
      const { budget, exceeded } = budgetWith({ enforced: false });
      for (let call = 0; call <= LIMITS.readsPerMinute; call += 1) {
        await budget.admit(readBy(KEY_A));
      }

      expect(exceeded()).toHaveLength(1);
      expect(exceeded()[0]?.fields.enforced).toBe(false);
    });
  });

  describe("when a read answers with rows", () => {
    /** @scenario "Rows returned are added to the credential's hourly and daily totals" */
    it("adds them to the credential's hour and day", async () => {
      const counter = memoryCounter();
      const { budget } = budgetWith({ enforced: true, counter });

      await budget.record({ ...readBy(SESSION), rows: 500 });

      expect(counter.used.get("read-budget:session:user-1:org-1:rows-hour")).toBe(500);
      expect(counter.used.get("read-budget:session:user-1:org-1:rows-day")).toBe(500);
    });

    /** @scenario "A credential past its hourly row allowance is refused before the next read runs" */
    it("refuses the next read once the hour's rows are spent", async () => {
      const { budget, exceeded } = budgetWith({ enforced: true });

      await budget.record({ ...readBy(SESSION), rows: LIMITS.rowsPerHour + 1 });

      expect(await codeOf(budget.admit(readBy(SESSION)))).toBe("read_rate_limited");
      expect(exceeded().at(-1)?.fields.dimension).toBe("rows_per_hour");
    });
  });

  describe("when a key starts exports", () => {
    /** @scenario "An export counts against the export allowance, not the read allowance" */
    it("refuses past the export allowance while reads still pass", async () => {
      const { budget, exceeded } = budgetWith({ enforced: true });
      await budget.admit(readBy(KEY_A, "export"));

      expect(await codeOf(budget.admit(readBy(KEY_A, "export")))).toBe("read_rate_limited");
      expect(exceeded().at(-1)?.fields.dimension).toBe("exports_per_minute");
      expect(await codeOf(budget.admit(readBy(KEY_A)))).toBeUndefined();
    });
  });

  describe("when a key starts exports past the minute's allowance while enforcement is off", () => {
    it("still counts each one against the day's allowance", async () => {
      const counter = memoryCounter();
      const { budget } = budgetWith({ enforced: false, counter });
      for (let call = 0; call < 3; call += 1) await budget.admit(readBy(KEY_A, "export"));

      expect(counter.used.get("read-budget:api_key:key-a:exports-day")).toBe(3);
    });
  });

  describe("given a platform operator acting as a customer", () => {
    /** @scenario "A read made while impersonating counts against the operator" */
    it("counts against the operator and leaves an audit line", async () => {
      const counter = memoryCounter();
      const { budget, lines } = budgetWith({ enforced: true, counter });

      await budget.admit(readBy(OPERATOR));

      expect(counter.used.get("read-budget:impersonation:operator-1:reads-minute")).toBe(1);
      expect(counter.used.has("read-budget:session:user-1:org-1:reads-minute")).toBe(false);
      expect(lines.find((line) => line.fields.event === "impersonated_read")?.fields).toMatchObject(
        { impersonatorId: "operator-1", subjectUserId: "user-1", route: "traces.searchTraces" },
      );
    });

    it("counts the operator's rows against the day's impersonation allowance alone", async () => {
      const counter = memoryCounter();
      const { budget, exceeded } = budgetWith({ enforced: true, counter });

      await budget.record({ ...readBy(OPERATOR), rows: LIMITS.impersonationRowsPerDay + 1 });

      expect(counter.used.has("read-budget:impersonation:operator-1:rows-hour")).toBe(false);
      expect(exceeded().map((line) => line.fields)).toEqual([
        expect.objectContaining({
          dimension: "rows_per_day",
          limit: LIMITS.impersonationRowsPerDay,
        }),
      ]);
    });

    /** @scenario "An operator past the impersonation ceiling is refused when enforcement is on" */
    it("refuses past the impersonation ceiling", async () => {
      const { budget, exceeded } = budgetWith({ enforced: true });
      for (let call = 0; call < LIMITS.impersonationReadsPerMinute; call += 1) {
        await budget.admit(readBy(OPERATOR));
      }

      expect(await codeOf(budget.admit(readBy(OPERATOR)))).toBe("read_rate_limited");
      expect(exceeded().at(-1)?.fields.credentialType).toBe("impersonation");
    });
  });

  describe("given the counting store is unreachable", () => {
    /** @scenario "A store failure never refuses a read" */
    it("admits the read and logs the failure", async () => {
      const { budget, lines } = budgetWith({ enforced: true, counter: failingCounter() });

      expect(await codeOf(budget.admit(readBy(KEY_A)))).toBeUndefined();
      expect(lines.some((line) => line.level === "error")).toBe(true);
    });
  });
});

describe("rowsOf", () => {
  describe("when the answer is a list or carries one", () => {
    it("counts the longest top-level list", () => {
      expect(rowsOf([1, 2, 3])).toBe(3);
      expect(rowsOf({ traces: [1, 2], columns: [1] })).toBe(2);
      expect(rowsOf({ id: "one" })).toBe(1);
      expect(rowsOf(undefined)).toBe(0);
    });
  });
});

describe("readKindOf", () => {
  describe("when a generated operation id names a POST query", () => {
    it("counts a LangWatchQL query as a read", () => {
      expect(readKindOf({ operation: "postApiV1Query", method: "POST" })).toBe("read");
    });
  });

  describe("when an operation exports or downloads", () => {
    it("counts it as an export, whatever its method", () => {
      expect(readKindOf({ operation: "exportTraces", method: "POST" })).toBe("export");
      expect(readKindOf({ operation: "downloadDataset", method: "GET" })).toBe("export");
      expect(readKindOf({ operation: "getApiV1TracesExport", method: "get" })).toBe("export");
    });
  });

  describe("when a call is a GET", () => {
    it("counts it as a read, whatever its name", () => {
      expect(readKindOf({ operation: "traces", method: "GET" })).toBe("read");
      expect(readKindOf({ operation: "createDraft", method: "get" })).toBe("read");
    });
  });

  describe("when a POST names a read by its prefix", () => {
    it.each(["searchTraces", "listDatasets", "getTrace", "findSpans", "queryTraces", "fetchRun"])(
      "counts %s as a read",
      (operation) => {
        expect(readKindOf({ operation, method: "POST" })).toBe("read");
      },
    );

    it("reads the prefix past a generated method and address", () => {
      expect(readKindOf({ operation: "postApiV1SearchTraces", method: "POST" })).toBe("read");
      expect(readKindOf({ operation: "postApiSearchTraces", method: "POST" })).toBe("read");
    });
  });

  describe("when a POST writes", () => {
    it("counts nothing", () => {
      expect(readKindOf({ operation: "postApiV1Datasets", method: "POST" })).toBe(null);
      expect(readKindOf({ operation: "createDataset", method: "POST" })).toBe(null);
    });
  });
});

describe("ReadRateLimitedError", () => {
  describe("when a read_rate_limited refusal is raised", () => {
    /** @scenario "The refusal carries a customer-safe message, the wait and the remediation" */
    it("is a 429 customer fault carrying the wait, the dimension, tips and copy", () => {
      const refusal = new ReadRateLimitedError({
        dimension: "rows_per_hour",
        retryAfterSeconds: 30,
      });

      expect(refusal.code).toBe("read_rate_limited");
      expect(refusal.httpStatus).toBe(429);
      expect(refusal.fault).toBe("customer");
      expect(refusal.meta).toEqual({ dimension: "rows_per_hour", retryAfterMs: 30_000 });
      expect(refusal.tips?.length).toBeGreaterThan(0);
      const shape = readHandledError(refusal);
      expect(shape).not.toBeNull();
      expect(shape && explainHandledError(shape).title).toBe("Too many reads just now");
    });
  });
});
