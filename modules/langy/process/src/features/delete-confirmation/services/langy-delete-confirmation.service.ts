import { ConfirmationRequiredError } from "@langwatch/api";
import type {
  RestConfirmationGate,
  RestConfirmationReceipt,
  RestConfirmationRequest,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { parseLangyChoiceSelectionPart } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";

import type {
  ConfirmKeyBinding,
  LangyDeleteConfirmationRepository,
} from "../../../repositories/langy-delete-confirmation.repository.ts";
import type { LangyLocalControlRequestRepository } from "../../../repositories/langy-local-control-request.repository.ts";
import {
  CONFIRM_CARD_TTL_SECONDS,
  CONFIRM_GRANT_TTL_SECONDS,
  confirmBlockWait,
  confirmationCard,
  cardRaisingRefusalMessage,
  cardUnavailableRefusalMessage,
  confirmationRefusalMessage,
  type ConfirmChoice,
  namedRecord,
  retryRefusalMessage,
  selectedOption,
  unboundRefusalMessage,
} from "../../../rules/langy-delete-confirmation.rules.ts";
import type { ConfirmTarget } from "../../../rules/langy-local-control-keys.rules.ts";
import type { StoredUserWait } from "../../../rules/langy-local-user-wait-record.rules.ts";
import type { UserWaitService } from "../../local-control/services/langy-local-user-wait.service.ts";
import type { LangyConfirmationAnswersService } from "./langy-confirmation-answers.service.ts";

const logger = createLogger("langwatch:langy:delete-confirmation");

/** How long one request may hold the right to raise a card before another may try. */
const CARD_RAISE_TTL_SECONDS = 30;

/**
 * Whether a record's card waits for the person, is being raised by another request, or cannot be
 * shown.
 */
type CardState = "shown" | "raising" | "unavailable";

type DeleteConfirmationMembers = Readonly<{
  confirmations: LangyDeleteConfirmationRepository;
  answers: Pick<LangyConfirmationAnswersService, "decide">;
  waits: Pick<UserWaitService, "startQuestion" | "poll" | "getWait" | "answer">;
  /** The folder-sharing key's own binding, which names its conversation too. */
  localKeys: Pick<LangyLocalControlRequestRepository, "findKeyBinding">;
  conversations: {
    findByIdVisible(input: {
      id: string;
      projectId: string;
      userId: string;
    }): Promise<{ isOwn: boolean; currentTurnId: string | null } | null>;
  };
}>;

/**
 * The gate every marked route asks for a Langy key: it runs only on an unspent Yes click for each
 * record, in the key's own conversation; otherwise it shows the card and refuses in words Langy
 * acts on. Spec: specs/langy/langy-delete-confirmation.feature
 */
export class LangyDeleteConfirmationService implements RestConfirmationGate {
  static create(members: DeleteConfirmationMembers): LangyDeleteConfirmationService {
    return new LangyDeleteConfirmationService(members);
  }

  private constructor(private readonly members: DeleteConfirmationMembers) {}

  /**
   * Spends one click per record, all or none. A record that does not exist needs no click, so
   * the request goes on and its handler answers for it.
   * @throws {ConfirmationRequiredError} when any record has no unspent click, or the key belongs
   * to no conversation
   */
  async confirm(request: RestConfirmationRequest): Promise<RestConfirmationReceipt | void> {
    const binding = await this.bindingOf(request.apiKeyId);
    if (!binding || binding.projectId !== request.projectId) {
      throw new ConfirmationRequiredError({
        message: unboundRefusalMessage(request.action),
        resource: request.resource,
        action: request.action,
      });
    }

    const targets = request.targets.map(({ id }) => ({
      projectId: request.projectId,
      conversationId: binding.conversationId,
      resource: request.resource,
      action: request.action,
      id,
    }));
    if (await this.members.confirmations.consumeGrants(targets)) return this.receiptFor(targets);

    const { unclicked, gone } = await this.sortUnclicked({ request, targets });

    // No record still lacks a click: spend the clicks of those that exist, and the handler
    // answers for any that do not.
    if (unclicked.length === 0) {
      const existing = targets.filter((target) => !gone.has(target));
      if (existing.length === 0) return;
      if (await this.members.confirmations.consumeGrants(existing)) {
        return this.receiptFor(existing);
      }
      throw new ConfirmationRequiredError({
        message: retryRefusalMessage(request.action),
        resource: request.resource,
        action: request.action,
      });
    }

    const records: string[] = [];
    const cards = new Set<CardState>();
    for (const { target, name } of unclicked) {
      cards.add(
        await this.showCard({
          target,
          name,
          binding,
          ownerUserId: request.ownerUserId,
        }),
      );
      records.push(namedRecord({ resource: target.resource, name, id: target.id }));
    }

    throw new ConfirmationRequiredError({
      message: refusalFor({ action: request.action, cards, records }),
      resource: request.resource,
      action: request.action,
    });
  }

  /**
   * A click that reached the platform as the next message, because the card had stopped
   * waiting or the panel could not answer it in place. Only the structured selection counts,
   * read by the option ids the card stored; the words beside it never do.
   */
  async acceptSelection({
    projectId,
    conversationId,
    userId,
    parts,
  }: {
    projectId: string;
    conversationId: string;
    userId: string;
    parts: readonly unknown[];
  }): Promise<void> {
    for (const part of parts) {
      const selection = parseLangyChoiceSelectionPart(part);
      const block = selection ? confirmBlockWait(selection.blockId) : { kind: "other" as const };
      if (!selection || block.kind !== "card") continue;
      const wait = await this.readWait(block.waitId);
      if (
        !wait?.confirm ||
        wait.projectId !== projectId ||
        wait.conversationId !== conversationId
      ) {
        continue;
      }

      const choice = selectedOption({
        confirm: wait.confirm,
        optionIds: selection.optionIds,
        otherText: selection.otherText,
      });
      await this.settle({ wait, choice, userId });
    }
  }

  /** A still-waiting card is answered in place, which records the click; any other is decided. */
  private async settle({
    wait,
    choice,
    userId,
  }: {
    wait: StoredUserWait;
    choice: ConfirmChoice;
    userId: string;
  }): Promise<void> {
    // A selection that names no option of the card says nothing, so it claims nothing either.
    if (choice.kind !== "option" || !wait.confirm) return;
    const { question, options } = wait.confirm;
    const label = options.find((option) => option.id === choice.optionId)?.label;
    if (wait.state === "pending" && label) {
      const answered = await this.members.waits
        .answer({ waitId: wait.waitId, userId, answers: [{ question, selected: [label] }] })
        .then(() => true)
        .catch((error: unknown) => {
          if (HandledError.isHandled(error) && error.code === "langy_wait_expired") return false;
          throw error;
        });
      if (answered) return;
    }

    await this.members.answers.decide({ wait, choice });
  }

  /** The records still lacking a click, with their names, and those that no longer exist. */
  private async sortUnclicked({
    request,
    targets,
  }: {
    request: RestConfirmationRequest;
    targets: readonly ConfirmTarget[];
  }): Promise<{
    unclicked: { target: ConfirmTarget; name: string | null }[];
    gone: Set<ConfirmTarget>;
  }> {
    // Each record's reads are independent, so they run together; any rejection still fails the
    // whole call. The name is read only for a record without a click, and the order kept.
    const looked = await Promise.all(
      targets.map(async (target, index) => {
        if (await this.members.confirmations.hasGrant(target)) {
          return { target, granted: true, name: undefined };
        }
        return { target, granted: false, name: await request.targets[index]?.name() };
      }),
    );
    const unclicked: { target: ConfirmTarget; name: string | null }[] = [];
    const gone = new Set<ConfirmTarget>();
    for (const { target, granted, name } of looked) {
      if (granted) continue;
      if (name === undefined) gone.add(target);
      else unclicked.push({ target, name });
    }
    return { unclicked, gone };
  }

  /** Gives the spent clicks back, for a route that failed on our side after spending them. */
  private receiptFor(targets: readonly ConfirmTarget[]): RestConfirmationReceipt {
    return {
      refund: async () => {
        await Promise.all(
          targets.map((target) =>
            this.members.confirmations.saveGrant({ target, ttlSeconds: CONFIRM_GRANT_TTL_SECONDS }),
          ),
        );
      },
    };
  }

  /**
   * The card for one record, unless one is already waiting for it or another request is raising
   * it right now.
   */
  private async showCard(card: {
    target: ConfirmTarget;
    name: string | null;
    binding: ConfirmKeyBinding;
    ownerUserId: string | null;
  }): Promise<CardState> {
    const { target } = card;
    if (await this.isWaiting(target)) return "shown";
    const token = generate("langy").toString();
    const claimed = await this.members.confirmations.claimCardRaise({
      target,
      token,
      ttlSeconds: CARD_RAISE_TTL_SECONDS,
    });
    // Another request is raising it: say a card is shown only once it is, never on its word.
    if (!claimed) return (await this.isWaiting(target)) ? "shown" : "raising";

    try {
      // Checked again under the claim: a request that raised the card just before it let go.
      const shown = (await this.isWaiting(target)) || (await this.raiseCard(card));
      return shown ? "shown" : "unavailable";
    } finally {
      await this.members.confirmations.releaseCardRaise({ target, token });
    }
  }

  private async raiseCard({
    target,
    name,
    binding,
    ownerUserId,
  }: {
    target: ConfirmTarget;
    name: string | null;
    binding: ConfirmKeyBinding;
    ownerUserId: string | null;
  }): Promise<boolean> {
    const turnId = await this.turnOf({ binding, ownerUserId });
    if (!turnId) {
      logger.warn(
        { conversationId: target.conversationId },
        "no turn to show a confirmation card on",
      );
      return false;
    }

    const card = confirmationCard({
      resource: target.resource,
      action: target.action,
      id: target.id,
      name,
    });
    const wait = await this.members.waits.startQuestion({
      projectId: target.projectId,
      conversationId: target.conversationId,
      turnId,
      questions: [card.question],
      confirm: card.confirm,
    });
    await this.members.confirmations.savePendingCard({
      target,
      waitId: wait.waitId,
      ttlSeconds: CONFIRM_CARD_TTL_SECONDS,
    });
    return true;
  }

  /**
   * Whether the card raised for this record still waits. Polling it once also settles one whose
   * time ran out, so the stale card leaves the screen before its replacement arrives.
   */
  private async isWaiting(target: ConfirmTarget): Promise<boolean> {
    const card = await this.members.confirmations.lookupPendingCard(target);
    if (card.kind !== "hit") return false;
    const poll = await this.members.waits.poll({ waitId: card.value, holdMs: 0 });
    return poll.outcome === "polled" && poll.answer.state === "pending";
  }

  /** The turn running now, else the one the key was minted in. */
  private async turnOf({
    binding,
    ownerUserId,
  }: {
    binding: ConfirmKeyBinding;
    ownerUserId: string | null;
  }): Promise<string | undefined> {
    const conversation = ownerUserId
      ? await this.members.conversations.findByIdVisible({
          id: binding.conversationId,
          projectId: binding.projectId,
          userId: ownerUserId,
        })
      : null;
    return conversation?.currentTurnId ?? binding.turnId;
  }

  /** A turn key's binding, else the folder-sharing key's: both name the conversation. */
  private async bindingOf(apiKeyId: string): Promise<ConfirmKeyBinding | undefined> {
    const bound = await this.members.confirmations.lookupKeyBinding(apiKeyId);
    if (bound.kind === "hit") return bound.value;
    const local = await this.members.localKeys.findKeyBinding(apiKeyId);
    return local.kind === "hit"
      ? { projectId: local.value.projectId, conversationId: local.value.conversationId }
      : undefined;
  }

  private async readWait(waitId: string): Promise<StoredUserWait | undefined> {
    return this.members.waits.getWait(waitId).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "langy_local_record_not_found") {
        return undefined;
      }
      throw error;
    });
  }
}

/** What Langy reads after the cards: the worst state among them decides. */
function refusalFor({
  action,
  cards,
  records,
}: {
  action: string;
  cards: ReadonlySet<CardState>;
  records: readonly string[];
}): string {
  if (cards.has("unavailable")) return cardUnavailableRefusalMessage(action);
  if (cards.has("raising")) return cardRaisingRefusalMessage(action);
  return confirmationRefusalMessage({ action, records });
}
