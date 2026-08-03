import { scopedApiKey } from "@/internal/credentialContext";
import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";
import { DEFAULT_ENDPOINT } from "@/internal/constants";

export type BudgetScopeKind =
  | "organization"
  | "team"
  | "project"
  | "virtual_key"
  | "principal"
  | "group"
  | "attributed_user";

export type BudgetWindow = "minute" | "hour" | "day" | "week" | "month" | "total" | "manual";
export type BudgetOnBreach = "block" | "warn";

export interface GatewayBudget {
  id: string;
  organization_id: string;
  scope_type: BudgetScopeKind;
  scope_id: string;
  name: string;
  description: string | null;
  window: BudgetWindow;
  on_breach: BudgetOnBreach;
  /**
   * For `group` rows this is the PER-MEMBER allowance, not a group total;
   * `spent_usd` sums the whole group and `member_count` says how many
   * members the allowance currently covers. For `attributed_user` rows it is
   * the PER-PERSON cap, and `end_users_seen` / `end_users_over` carry the
   * standing instead of `spent_usd`.
   */
  limit_usd: string;
  spent_usd: string;
  timezone: string | null;
  /** ModelProvider id the budget counts; null counts every provider. */
  provider_key: string | null;
  current_period_started_at: string;
  resets_at: string;
  last_reset_at: string | null;
  archived_at: string | null;
  created_at: string;
  /** `group` rows only. */
  member_count?: number;
  /** `attributed_user` rows only: end users with spend this period. */
  end_users_seen?: number;
  /** `attributed_user` rows only: how many of those are at or over the cap. */
  end_users_over?: number;
}

export interface GatewayBudgetList {
  budgets: GatewayBudget[];
  /**
   * False when spend could not be totalled — render "unavailable" rather
   * than trusting `spent_usd` as real spend.
   */
  spend_available: boolean;
}

export type CreateGatewayBudgetScope =
  | { kind: "organization"; organization_id: string }
  | { kind: "team"; team_id: string }
  | { kind: "project"; project_id: string }
  | { kind: "virtual_key"; virtual_key_id: string }
  | { kind: "principal"; principal_user_id: string }
  | { kind: "group"; group_id: string }
  // Template: each distinct external end user on the anchor gets the
  // budget's limit per window. Exactly one anchor id.
  | {
      kind: "attributed_user";
      anchor_virtual_key_id?: string;
      anchor_project_id?: string;
    };

export interface CreateGatewayBudgetInput {
  scope: CreateGatewayBudgetScope;
  name: string;
  description?: string;
  window: BudgetWindow;
  limit_usd: number | string;
  on_breach?: BudgetOnBreach;
  timezone?: string | null;
  /** ModelProvider id to pin the budget to one provider. */
  provider_key?: string | null;
}

export interface UpdateGatewayBudgetInput {
  name?: string;
  description?: string | null;
  limit_usd?: number | string;
  on_breach?: BudgetOnBreach;
  timezone?: string | null;
}

export class GatewayBudgetsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "GatewayBudgetsApiError";
  }
}

export class GatewayBudgetsApiService {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly projectId: string | undefined;

  constructor(config?: { endpoint?: string; apiKey?: string; projectId?: string }) {
    this.endpoint = (config?.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
    this.apiKey = config?.apiKey ?? scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
    this.projectId = config?.projectId ?? process.env.LANGWATCH_PROJECT_ID;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      // Org-anchored API keys carry no project of their own; the surface
      // scopes on this header. Absent for project keys, which self-scope.
      ...(this.projectId ? { "X-Project-Id": this.projectId } : {}),
    };
  }

  private async request<T>(operation: string, path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      let parsedBody: unknown;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = await response.text();
      }
      const message = formatApiErrorForOperation({
        operation,
        error: parsedBody,
        options: { status: response.status },
      });
      throwIfHandledError({
        operation,
        error: parsedBody,
        status: response.status,
        message,
      });
      throw new GatewayBudgetsApiError(message, operation, parsedBody);
    }
    return (await response.json()) as T;
  }

  /**
   * Every non-archived budget in the organization across all six scope
   * types, optionally filtered by `scopeTypes`.
   */
  async list(options?: {
    scopeTypes?: BudgetScopeKind[];
  }): Promise<GatewayBudgetList> {
    const filter = options?.scopeTypes?.length
      ? `?scope_type=${options.scopeTypes.join(",")}`
      : "";
    const { data, spend_available } = await this.request<{
      data: GatewayBudget[];
      spend_available: boolean;
    }>("list gateway budgets", `/api/gateway/v1/budgets${filter}`);
    return { budgets: data, spend_available };
  }

  async create(input: CreateGatewayBudgetInput): Promise<GatewayBudget> {
    const { budget } = await this.request<{ budget: GatewayBudget }>(
      "create gateway budget",
      "/api/gateway/v1/budgets",
      { method: "POST", body: JSON.stringify(input) },
    );
    return budget;
  }

  async update(id: string, input: UpdateGatewayBudgetInput): Promise<GatewayBudget> {
    const { budget } = await this.request<{ budget: GatewayBudget }>(
      `update gateway budget "${id}"`,
      `/api/gateway/v1/budgets/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    return budget;
  }

  async archive(id: string): Promise<GatewayBudget> {
    const { budget } = await this.request<{ budget: GatewayBudget }>(
      `archive gateway budget "${id}"`,
      `/api/gateway/v1/budgets/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    return budget;
  }

  /**
   * Move the budget's period boundary to now. Recorded spend is never
   * mutated; with `endUserId` only that end-user bucket's boundary moves.
   */
  async reset(
    id: string,
    options: { endUserId?: string; reason?: string } = {},
  ): Promise<GatewayBudget> {
    const query = options.endUserId
      ? `?end_user_id=${encodeURIComponent(options.endUserId)}`
      : "";
    const { budget } = await this.request<{ budget: GatewayBudget }>(
      `reset gateway budget "${id}"`,
      `/api/gateway/v1/budgets/${encodeURIComponent(id)}/reset${query}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.reason ? { reason: options.reason } : {}),
      },
    );
    return budget;
  }
}
