import type { BreakGlassBinding } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import { Temporal } from "@langwatch/time";

const logger = createLogger("langwatch:identity:break-glass:expiry-warn");

/**
 * Who is told a way back in is ending. A channel rather than a mailer call so
 * the sweep says WHAT is due and the process decides how it reaches somebody
 * — the same split the identity email service already makes.
 */
export abstract class SsoBreakGlassWarningChannel {
  abstract warn(args: {
    binding: BreakGlassBinding;
    /** How many days remain: fourteen, seven or one. */
    daysRemaining: number;
  }): Promise<void>;
}

/**
 * The warning as an operator-visible log line: who holds the way back in,
 * who granted it, and how many days remain before activation is refused.
 */
export class LoggedSsoBreakGlassWarningChannel extends SsoBreakGlassWarningChannel {
  private constructor() {
    super();
  }

  static create(): LoggedSsoBreakGlassWarningChannel {
    return new LoggedSsoBreakGlassWarningChannel();
  }

  async warn({
    binding,
    daysRemaining,
  }: Parameters<SsoBreakGlassWarningChannel["warn"]>[0]): Promise<void> {
    logger.warn(
      {
        organizationId: binding.organizationId,
        userId: binding.userId,
        grantedByUserId: binding.grantedByUserId,
        expiresAt: Temporal.Instant.fromEpochMilliseconds(binding.expiresAtMs).toString(),
        daysRemaining,
      },
      "a way back in without the identity provider is ending; renew it or activation will be refused after it does",
    );
  }
}
