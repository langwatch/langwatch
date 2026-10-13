import type { EventingCommandSender } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type { RecordInstallationConnectedCommandData } from "../eventing/github-lifecycle.events.ts";

/** github_lifecycle's senders, bound once the pipeline registers in this process. */
export type GithubLifecycleSenders = Readonly<{
  recordInstallationConnected: Pick<
    EventingCommandSender<RecordInstallationConnectedCommandData>,
    "send"
  >;
}>;

/** Records GitHub's installation facts on its own pipeline; peers react from their side. */
export class GithubInstallationFactsService {
  #senders: GithubLifecycleSenders | undefined;

  static create(): GithubInstallationFactsService {
    return new GithubInstallationFactsService();
  }

  private constructor() {}

  connect(senders: GithubLifecycleSenders): void {
    this.#senders = senders;
  }

  /** Throws when github_lifecycle is not registered here or the record fails. */
  async recordInstallationConnected(input: {
    organizationId: string;
    installationId: string;
  }): Promise<void> {
    const senders = this.#senders;
    if (!senders) throw new Error("github_lifecycle is not registered in this process");
    await senders.recordInstallationConnected.send({
      tenantId: input.organizationId,
      organizationId: input.organizationId,
      installationId: input.installationId,
      occurredAt: nowInstant().epochMilliseconds,
    });
  }
}
