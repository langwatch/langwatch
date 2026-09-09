import type { LogPiiRedactionLevel } from "@langwatch/log-contract";

export abstract class LogRedactionPort {
  abstract redactLog(
    log: {
      body: string;
      attributes: Record<string, string>;
      resourceAttributes: Record<string, string>;
      attributeNames?: Record<string, string>;
    },
    piiRedactionLevel: LogPiiRedactionLevel,
    tenantId?: string,
  ): Promise<void>;
}
