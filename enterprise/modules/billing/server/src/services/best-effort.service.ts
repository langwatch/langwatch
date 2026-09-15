import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:billing:best-effort");

/**
 * Side effect that never fails its caller; Stripe retries 5xx. Wrap only
 * effects nobody branches on.
 */
export class BestEffortService {
  private constructor() {}

  static create(): BestEffortService {
    return new BestEffortService();
  }

  async run({
    label,
    context,
    effect,
  }: {
    label: string;
    context?: Record<string, unknown>;
    effect: () => Promise<void> | void;
  }): Promise<void> {
    try {
      await effect();
    } catch (err) {
      try {
        logger.error({ ...context, err }, `[bestEffort] ${label} failed`);
      } catch {
        // Reporting a best-effort failure must not become the caller's failure.
      }
    }
  }
}
