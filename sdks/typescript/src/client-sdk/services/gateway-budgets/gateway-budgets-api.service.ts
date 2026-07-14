import { formatApiErrorForOperation } from "@/client-sdk/services/_shared/format-api-error";
import { DEFAULT_ENDPOINT } from "@/internal/constants";

export type BudgetScopeKind =
  | "ORGANIZATION"
  | "TEAM"
  | "PROJECT"
  | "VIRTUAL_KEY"
  | "PRINCIPAL";

export type BudgetWindow = "MINUTE" | "HOUR" | "DAY" | "WEEK" | "MONTH" | "TOTAL";
export type BudgetOnBreach = "BLOCK" | "WARN";

export interface GatewayBudget {
  id: string;
  organization_id: string;
  scope_type: BudgetScopeKind;
  scope_id: string;
  name: string;
  description: string | null;
  window: BudgetWindow;
  on_breach: BudgetOnBreach;
  limit_usd: string;
  spent_usd: string;
  timezone: string | null;
  current_period_started_at: string;
  resets_at: string;
  last_reset_at: string | null;
  archived_at: string | null;
  created_at: string;
}

export type CreateGatewayBudgetScope =
  | { kind: "ORGANIZATION"; organization_id: string }
  | { kind: "TEAM"; team_id: string }
  | { kind: "PROJECT"; project_id: string }
  | { kind: "VIRTUAL_KEY"; virtual_key_id: string }
  | { kind: "PRINCIPAL"; principal_user_id: string };

export interface CreateGatewayBudgetInput {
  scope: CreateGatewayBudgetScope;
  name: string;
  description?: string;
  window: BudgetWindow;
  limit_usd: number | string;
  on_breach?: BudgetOnBreach;
  timezone?: string | null;
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

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.endpoint = (config?.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT).replace(/\/+$/, "");
    this.apiKey = config?.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
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
      throw new GatewayBudgetsApiError(message, operation, parsedBody);
    }
    return (await response.json()) as T;
  }

  async list(): Promise<GatewayBudget[]> {
    const { data } = await this.request<{ data: GatewayBudget[] }>(
      "list gateway budgets",
      "/api/gateway/v1/budgets",
    );
    return data;
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
}
