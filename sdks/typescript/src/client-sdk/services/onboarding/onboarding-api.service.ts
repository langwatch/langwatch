/**
 * The `/api/v1/onboarding` family: the guided onboarding state of the
 * organization the credential's project belongs to.
 *
 * CLI-only, deliberately not exported from the client SDK's public index: an
 * application instruments and reads data, it does not report on the
 * onboarding of the organization it runs inside. Langy calls it at the end
 * of a guided setup so the Home offer and the campaigns see the path finish.
 */
import { scopedApiKey } from "@/internal/credentialContext";
import { langwatchFetch } from "@/internal/http/langwatchFetch";
import { resolveEndpoint } from "@/internal/endpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";
import { throwIfHandledError } from "@/client-sdk/services/_shared/throw-handled-error";

export type GuidedOnboardingPath = "llmops" | "coding" | "gateway" | "governance";

export interface GuidedOnboardingState {
  paths: GuidedOnboardingPath[];
  currentPath?: GuidedOnboardingPath;
  donePaths: GuidedOnboardingPath[];
  provider?: string;
  providerModel?: string;
  tourCompletedAt?: string;
  tourSkippedAt?: string;
  providerSkippedAt?: string;
  conversationId?: string;
  tourReplays?: number;
}

export class OnboardingApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "OnboardingApiError";
  }
}

export class OnboardingApiService {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(config?: { apiKey?: string; endpoint?: string }) {
    this.apiKey =
      config?.apiKey ?? scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
    this.endpoint = resolveEndpoint(config?.endpoint);
  }

  getGuidedState(): Promise<GuidedOnboardingState> {
    return this.request<GuidedOnboardingState>("getGuidedState", "/api/v1/onboarding/guided");
  }

  completePath(path: string): Promise<GuidedOnboardingState> {
    return this.request<GuidedOnboardingState>(
      "completePath",
      `/api/v1/onboarding/guided/paths/${encodeURIComponent(path)}/complete`,
      { method: "POST" },
    );
  }

  private async request<T>(
    operation: string,
    path: string,
    options?: RequestInit,
  ): Promise<T> {
    const response = await langwatchFetch(`${this.endpoint}${path}`, {
      ...options,
      headers: {
        ...buildAuthHeaders({ apiKey: this.apiKey }),
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsed: unknown = errorText;
      try {
        parsed = JSON.parse(errorText);
      } catch {
        // leave as raw text
      }
      const message = formatApiErrorMessage({
        error: parsed,
        options: { status: response.status },
      });
      throwIfHandledError({
        operation,
        error: parsed,
        status: response.status,
        message,
      });
      throw new OnboardingApiError(message, operation, parsed);
    }

    return (await response.json()) as T;
  }
}
