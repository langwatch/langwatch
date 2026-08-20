import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How `langwatch gateway-budgets list` renders a per-person template.
 *
 * The template's limit belongs to each end user separately, so the
 * spent-over-limit percentage every other scope shows is meaningless here:
 * it would divide a per-person cap into one bucket's spend and report a
 * confident number about nobody. The row reports a headcount instead.
 */
const mockList = vi.fn();

vi.mock(
  "@/client-sdk/services/gateway-budgets/gateway-budgets-api.service",
  () => ({
    GatewayBudgetsApiService: class {
      list = mockList;
    },
  }),
);

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

import { listGatewayBudgetsCommand } from "../list";

function budget(overrides: Record<string, unknown> = {}) {
  return {
    id: "bdg_template",
    organization_id: "org_1",
    scope_type: "attributed_user",
    scope_id: "vk_anchor_0123456789",
    name: "Per-seat cap",
    description: null,
    window: "month",
    on_breach: "block",
    limit_usd: "1.00",
    spent_usd: "0",
    timezone: null,
    provider_key: null,
    current_period_started_at: "2026-07-01T00:00:00.000Z",
    resets_at: "2026-08-01T00:00:00.000Z",
    last_reset_at: null,
    archived_at: null,
    created_at: "2026-06-01T00:00:00.000Z",
    end_users_seen: 10,
    end_users_over: 3,
    ...overrides,
  };
}

/** The rendered table, with colour codes stripped. */
async function renderedTable(
  rows: Array<Record<string, unknown>>,
): Promise<string> {
  // `list()` walks the endpoint's pages to exhaustion, so what it hands the
  // command is the whole listing as a plain array, with no cursor left to
  // carry and no envelope to unwrap.
  mockList.mockResolvedValue(rows);
  const lines: string[] = [];
  const spy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  try {
    const result = await listGatewayBudgetsCommand();
    if (result && "table" in result) result.table?.();
  } finally {
    spy.mockRestore();
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape codes from chalk output is the whole point of the regex
  return lines.join("\n").replace(/\[[0-9;]*m/g, "");
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("gateway-budgets list rendering a per-person template", () => {
  /** @scenario "The budget list shows a per-person template as a cap and a headcount" */
  it("labels the limit as a per-person cap", async () => {
    const table = await renderedTable([budget()]);

    expect(table).toContain("$1.00/person");
  });

  /** @scenario "The budget list shows a per-person template as a cap and a headcount" */
  it("reports the headcount over cap instead of a spend percentage", async () => {
    const table = await renderedTable([budget()]);

    expect(table).toContain("3 of 10 over cap");
    expect(table).not.toContain("%");
  });

  /** @scenario "A per-person template nobody has used yet says so instead of showing a dash" */
  it("says 0 of 0 for a template nobody has spent against", async () => {
    const table = await renderedTable([
      budget({ end_users_seen: 0, end_users_over: 0 }),
    ]);

    expect(table).toContain("0 of 0 over cap");
  });

  /** @scenario "The budget list shows a per-person template as a cap and a headcount" */
  it("keeps every other scope on the spend percentage", async () => {
    const table = await renderedTable([
      budget({
        scope_type: "project",
        limit_usd: "100.00",
        spent_usd: "25.00",
        end_users_seen: undefined,
        end_users_over: undefined,
      }),
    ]);

    expect(table).toContain("$25.00 (25%)");
    expect(table).not.toContain("over cap");
  });
});
