import { createLogger } from "@langwatch/observability";

import type { LangyDeleteConfirmationRepository } from "../../../repositories/langy-delete-confirmation.repository.ts";
import {
  CONFIRM_CARD_TTL_SECONDS,
  CONFIRM_GRANT_TTL_SECONDS,
  chosenOption,
  type ConfirmChoice,
} from "../../../rules/langy-delete-confirmation.rules.ts";
import type { ConfirmTarget } from "../../../rules/langy-local-control-keys.rules.ts";
import type { StoredUserWait } from "../../../rules/langy-local-user-wait-record.rules.ts";

const logger = createLogger("langwatch:langy:delete-confirmation");

/**
 * Turns the answer on a confirmation card into an unspent click. The first answer claims the
 * card, whichever way it arrived; only the card's own Yes option grants, and only once.
 * Spec: specs/langy/langy-delete-confirmation.feature
 */
export class LangyConfirmationAnswersService {
  static create({
    confirmations,
  }: {
    confirmations: Pick<LangyDeleteConfirmationRepository, "claimCard" | "saveGrant">;
  }): LangyConfirmationAnswersService {
    return new LangyConfirmationAnswersService(confirmations);
  }

  private constructor(
    private readonly confirmations: Pick<
      LangyDeleteConfirmationRepository,
      "claimCard" | "saveGrant"
    >,
  ) {}

  /** An answered card, as the wait records it; any card that is not a confirmation is ignored. */
  async recordAnswer(wait: StoredUserWait): Promise<void> {
    if (!wait.confirm || wait.state !== "answered") return;
    await this.decide({
      wait,
      choice: chosenOption({ confirm: wait.confirm, answers: wait.answers }),
    });
  }

  /** The option a card's first answer picked, by its stored id. */
  async decide({ wait, choice }: { wait: StoredUserWait; choice: ConfirmChoice }): Promise<void> {
    const { confirm } = wait;
    if (!confirm) return;
    const claimed = await this.confirmations.claimCard({
      waitId: wait.waitId,
      ttlSeconds: CONFIRM_CARD_TTL_SECONDS,
    });
    if (!claimed || choice.kind !== "option" || choice.optionId !== confirm.yesOptionId) return;

    await this.confirmations.saveGrant({
      target: confirmTargetOf(wait),
      ttlSeconds: CONFIRM_GRANT_TTL_SECONDS,
    });
    logger.info(
      { waitId: wait.waitId, resource: confirm.resource, action: confirm.action },
      "confirmation card answered yes",
    );
  }
}

/** The record a confirmation card asked about. */
function confirmTargetOf(wait: StoredUserWait): ConfirmTarget {
  return {
    projectId: wait.projectId,
    conversationId: wait.conversationId,
    resource: wait.confirm?.resource ?? "",
    action: wait.confirm?.action ?? "",
    id: wait.confirm?.id ?? "",
  };
}
