import { createLogger } from "../../../src/utils/logger/server";
import { captureException } from "../../../src/utils/posthogErrorCapture";
import type { AppConfig } from "../../../src/server/app-layer/config";
import type {
  CioBatchCall,
  CioEventName,
  CioOrgTraits,
  CioPersonTraits,
} from "./types";

const logger = createLogger("ee:nurturing-service");

const EXTERNAL_SERVICE_TIMEOUT_MS = 10_000;

const REGIONAL_ENDPOINTS = {
  us: "https://cdp.customer.io/v1",
  eu: "https://cdp-eu.customer.io/v1",
} as const;

type Region = keyof typeof REGIONAL_ENDPOINTS;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type NurturingServiceOptions = {
  config: Pick<AppConfig, "customerIoApiKey" | "customerIoRegion">;
  fetchFn?: typeof fetch;
};

// ---------------------------------------------------------------------------
// NurturingService — Customer.io Pipelines API client
// ---------------------------------------------------------------------------

/**
 * Wraps the Customer.io Pipelines API with fire-and-forget semantics.
 *
 * Callers use optional chaining (`nurturing?.identifyUser(...)`) when the
 * service may be absent (e.g. self-hosted without Customer.io).
 * Defense-in-depth: methods silently no-op if the API key is missing.
 */
export class NurturingService {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  private constructor(options: NurturingServiceOptions) {
    this.apiKey = options.config.customerIoApiKey;
    const region = options.config.customerIoRegion;
    this.baseUrl =
      region && region in REGIONAL_ENDPOINTS
        ? REGIONAL_ENDPOINTS[region as Region]
        : REGIONAL_ENDPOINTS.eu;
    this.fetchFn =
      options.fetchFn ?? ((...args) => fetch(...args)) as typeof fetch;
  }

  /**
   * Factory method for creating a NurturingService.
   * If the API key is falsy, all methods behave as silent no-ops.
   */
  static create(options: NurturingServiceOptions): NurturingService {
    return new NurturingService(options);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Identify a user with person-level traits in Customer.io. */
  async identifyUser({
    userId,
    traits,
  }: {
    userId: string;
    traits: Partial<CioPersonTraits>;
  }): Promise<void> {
    await this.post("/identify", { userId, traits });
  }

  /** Track a named event for a user in Customer.io. */
  async trackEvent({
    userId,
    event,
    properties,
  }: {
    userId: string;
    event: CioEventName;
    properties?: Record<string, unknown>;
  }): Promise<void> {
    await this.post("/track", { userId, event, properties });
  }

  /** Associate a user with an organization (group) in Customer.io. */
  async groupUser({
    userId,
    groupId,
    traits,
  }: {
    userId: string;
    groupId: string;
    traits?: Partial<CioOrgTraits>;
  }): Promise<void> {
    await this.post("/group", { userId, groupId, traits });
  }

  /** Send multiple operations in a single batch request. */
  async batch(calls: CioBatchCall[]): Promise<void> {
    const batchItems = calls.map((call) => {
      switch (call.type) {
        case "identify":
          return { type: "identify", userId: call.userId, traits: call.traits };
        case "track":
          return {
            type: "track",
            userId: call.userId,
            event: call.event,
            properties: call.properties,
          };
        case "group":
          return {
            type: "group",
            userId: call.userId,
            groupId: call.groupId,
            traits: call.traits,
          };
      }
    });
    await this.post("/batch", { batch: batchItems });
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async post(path: string, body: unknown): Promise<void> {
    if (!this.apiKey) {
      return;
    }

    const url = `${this.baseUrl}${path}`;
    logger.error({ url, body: JSON.stringify(body).slice(0, 500) }, `[CIO] >>> ${path}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      EXTERNAL_SERVICE_TIMEOUT_MS,
    );

    try {
      const response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            "Basic " + Buffer.from(`${this.apiKey}:`).toString("base64"),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseBody = await response.text().catch(() => "<unreadable>");
        logger.error(
          { path, status: response.status, responseBody: responseBody.slice(0, 500) },
          `[CIO] <<< ${path} FAILED: HTTP ${response.status}`,
        );
        captureException(
          new Error(`Customer.io ${path} failed: HTTP ${response.status}`),
          { extra: { path, status: response.status } },
        );
      } else {
        logger.error({ path, status: response.status }, `[CIO] <<< ${path} OK`);
      }
    } catch (error) {
      logger.error({ error, path }, `[CIO] <<< ${path} EXCEPTION`);
      captureException(error);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
