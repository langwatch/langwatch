import type {
  CioBatchCall,
  CioEventName,
  CioOrgTraits,
  CioPersonTraits,
} from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { CustomerIoChannel, type CustomerIoChannelOptions } from "../customer-io.channel.ts";

const logger = createLogger("ee:customer-io-channel");
const EXTERNAL_SERVICE_TIMEOUT_MS = 10_000;
const REGIONAL_ENDPOINTS: Readonly<{ us: string; eu: string }> = {
  us: "https://cdp.customer.io/v1",
  eu: "https://cdp-eu.customer.io/v1",
};

export class HttpCustomerIoChannel extends CustomerIoChannel {
  static readonly requires: readonly [] = [];

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly errorReporter: CustomerIoChannelOptions["errorReporter"];

  private constructor(options: CustomerIoChannelOptions) {
    super();
    this.apiKey = options.config.customerIoApiKey;
    this.baseUrl =
      options.config.customerIoRegion === "us" ? REGIONAL_ENDPOINTS.us : REGIONAL_ENDPOINTS.eu;
    this.fetchFn = options.fetchFn ?? fetch;
    this.errorReporter = options.errorReporter;
  }

  static create(options: CustomerIoChannelOptions): HttpCustomerIoChannel {
    return new HttpCustomerIoChannel(options);
  }

  identifyUser(input: { userId: string; traits: Partial<CioPersonTraits> }): Promise<void> {
    return this.post("/identify", input);
  }

  trackEvent(input: {
    userId: string;
    event: CioEventName;
    properties?: Record<string, unknown>;
  }): Promise<void> {
    return this.post("/track", input);
  }

  groupUser(input: {
    userId: string;
    groupId: string;
    traits?: Partial<CioOrgTraits>;
  }): Promise<void> {
    return this.post("/group", input);
  }

  batch(calls: CioBatchCall[]): Promise<void> {
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
    return this.post("/batch", { batch: batchItems });
  }

  private async post(path: "/identify" | "/track" | "/group" | "/batch", body: unknown) {
    if (!this.apiKey) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_SERVICE_TIMEOUT_MS);
    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + Buffer.from(`${this.apiKey}:`).toString("base64"),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const responseBody =
          typeof response.text === "function"
            ? await response.text().catch(() => "<unreadable>")
            : "<unreadable>";
        const error = new Error(`Customer.io ${path} failed: HTTP ${response.status}`);
        logger.error(
          { path, status: response.status, responseBody: responseBody.slice(0, 500) },
          `[CIO] <<< ${path} FAILED: HTTP ${response.status}`,
        );
        this.errorReporter?.capture(error, { path, status: response.status });
      }
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      logger.error({ error, path }, `[CIO] <<< ${path} EXCEPTION`);
      this.errorReporter?.capture(normalizedError);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
