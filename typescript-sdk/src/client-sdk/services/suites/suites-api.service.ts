
export interface SuiteTarget {
  type: "prompt" | "http" | "code" | "workflow";
  referenceId: string;
}

export interface SuiteResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  scenarioIds: string[];
  targets: SuiteTarget[];
  repeatCount: number;
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSuiteBody {
  name: string;
  description?: string;
  scenarioIds: string[];
  targets: SuiteTarget[];
  repeatCount?: number;
  labels?: string[];
}

export interface UpdateSuiteBody {
  name?: string;
  description?: string | null;
  scenarioIds?: string[];
  targets?: SuiteTarget[];
  repeatCount?: number;
  labels?: string[];
}

export interface SuiteRunResult {
  scheduled: boolean;
  batchRunId: string;
  setId: string;
  jobCount: number;
  skippedArchived: {
    scenarios: string[];
    targets: string[];
  };
  items: Array<{
    scenarioRunId: string;
    scenarioId: string;
    target: SuiteTarget;
    name: string | null;
  }>;
}

export class SuitesApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "SuitesApiError";
  }
}

export class SuitesApiService {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor() {
    this.apiKey = process.env.LANGWATCH_API_KEY ?? "";
    this.endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.endpoint}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": this.apiKey,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage: string;
      try {
        const parsed = JSON.parse(errorBody) as { error?: string };
        errorMessage = parsed.error ?? errorBody;
      } catch {
        errorMessage = errorBody;
      }
      throw new SuitesApiError(
        errorMessage,
        `${method} ${path}`,
        { status: response.status, body: errorBody },
      );
    }

    return response.json() as Promise<T>;
  }

  async getAll(): Promise<SuiteResponse[]> {
    return this.request("GET", "/api/suites");
  }

  async get(id: string): Promise<SuiteResponse> {
    return this.request("GET", `/api/suites/${encodeURIComponent(id)}`);
  }

  async create(params: CreateSuiteBody): Promise<SuiteResponse> {
    return this.request("POST", "/api/suites", params);
  }

  async update(id: string, params: UpdateSuiteBody): Promise<SuiteResponse> {
    return this.request("PATCH", `/api/suites/${encodeURIComponent(id)}`, params);
  }

  async duplicate(id: string): Promise<SuiteResponse> {
    return this.request("POST", `/api/suites/${encodeURIComponent(id)}/duplicate`);
  }

  async run(id: string, idempotencyKey?: string): Promise<SuiteRunResult> {
    return this.request("POST", `/api/suites/${encodeURIComponent(id)}/run`, {
      idempotencyKey: idempotencyKey ?? `cli-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  }

  async delete(id: string): Promise<{ id: string; archived: boolean }> {
    return this.request("DELETE", `/api/suites/${encodeURIComponent(id)}`);
  }
}
