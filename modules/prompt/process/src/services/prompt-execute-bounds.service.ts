import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { RateLimiter } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  PromptExecuteRateLimitedError,
  PromptMessagesTooManyError,
} from "@langwatch/prompt-contract";

/**
 * The tier-effective ceilings the playground's execution door runs under: the
 * caller's tier value resolves through the entitlement peer, and each run
 * counts against the project's window — the invoice is the project's.
 */
export class PromptExecuteBoundsService {
  static create(deps: {
    entitlement: EntitlementApi;
    projects: ProjectApi;
    rateLimiter: RateLimiter;
  }): PromptExecuteBoundsService {
    return new PromptExecuteBoundsService(deps);
  }

  readonly #entitlement: EntitlementApi;
  readonly #projects: ProjectApi;
  readonly #rateLimiter: RateLimiter;

  private constructor(deps: {
    entitlement: EntitlementApi;
    projects: ProjectApi;
    rateLimiter: RateLimiter;
  }) {
    this.#entitlement = deps.entitlement;
    this.#projects = deps.projects;
    this.#rateLimiter = deps.rateLimiter;
  }

  /**
   * Counts one run against the project's window and refuses a message array
   * above the plan's bound — both before any LLM work starts.
   */
  async assertExecuteWithinBounds(input: {
    projectId: string;
    messageCount: number;
  }): Promise<void> {
    const organizationId = await this.#projects.getOrganizationId(input.projectId);

    const requests = await this.#entitlement.requestBound({
      key: "promptExecutePerMinute",
      organizationId,
    });
    const decision = await this.#rateLimiter.check(`prompt-execute:${input.projectId}`, {
      requests,
      seconds: 60,
    });
    if (!decision.allowed) {
      throw new PromptExecuteRateLimitedError({ retryAfterSeconds: decision.retryAfterSeconds });
    }

    const maxMessages = await this.#entitlement.requestBound({
      key: "promptMessagesMax",
      organizationId,
    });
    if (input.messageCount > maxMessages) {
      throw new PromptMessagesTooManyError(maxMessages);
    }
  }
}
