/**
 * The words and ids of a confirmation card, and how an answer is read against them. Pure: no
 * store is reachable from here. Spec: specs/langy/langy-delete-confirmation.feature
 */
import { QUESTION_WAIT_BUDGET_MS } from "@langwatch/langy-contract";

import type { UserWaitConfirm, UserWaitQuestion } from "./langy-local-user-wait-record.rules.ts";

/** How long one Yes click stays unspent. */
export const CONFIRM_GRANT_TTL_SECONDS = 5 * 60;

/**
 * The panel names a question's options `opt-1`, `opt-2`, … in the order they are listed, and a
 * click sent as a message carries those ids. The card stores the same ids, so the click reads
 * against what the platform wrote and never against a label.
 */
const YES_OPTION_ID = "opt-1";
const NO_OPTION_ID = "opt-2";

/** "delete" → "Delete". */
function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** "delete" → "Deleting", "disable" → "Disabling". */
function gerund(action: string): string {
  return `${capitalized(action.replace(/e$/, ""))}ing`;
}

/** The longest a record's name runs on a card before it is cut short. */
const MAX_NAME_LENGTH = 80;

/** How many trailing characters of the id tell two records of the same name apart. */
const ID_TAIL_LENGTH = 4;

/** Text a record's owner wrote, made safe for one line: no control characters, at most 80. */
function oneLine(text: string): string {
  const flat = text
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > MAX_NAME_LENGTH ? `${flat.slice(0, MAX_NAME_LENGTH - 1)}…` : flat;
}

/**
 * One record as the card and the refusal name it: `evaluator "Toxicity check" (…a1b2)`. The tail
 * of the id tells apart two records that share a name; a record with no name is named by its id.
 */
export function namedRecord({
  resource,
  name,
  id,
}: {
  resource: string;
  name: string | null;
  id: string;
}): string {
  const shownId = oneLine(id);
  const title = name === null ? "" : oneLine(name);
  if (title === "") return `${resource} "${shownId}"`;

  return `${resource} "${title}" (…${shownId.slice(-ID_TAIL_LENGTH)})`;
}

/** The card the platform asks, written from the record's own name, with fixed options. */
export function confirmationCard({
  resource,
  action,
  id,
  name,
}: {
  resource: string;
  action: string;
  id: string;
  name: string | null;
}): { question: UserWaitQuestion; confirm: UserWaitConfirm } {
  const options = [
    { id: YES_OPTION_ID, label: `Yes, ${action}` },
    { id: NO_OPTION_ID, label: "No, keep it" },
  ];
  const question = `${capitalized(action)} ${namedRecord({ resource, name, id })}?`;

  return {
    question: {
      question,
      header: "Confirm",
      options: options.map(({ label }) => ({ label })),
      multiple: false,
      allowOther: false,
    },
    confirm: { question, resource, action, id, options, yesOptionId: YES_OPTION_ID },
  };
}

/** What one answer picked on a confirmation card: one of its stored options, or nothing. */
export type ConfirmChoice = { kind: "option"; optionId: string } | { kind: "nothing" };

const NOTHING: ConfirmChoice = { kind: "nothing" };

/**
 * The stored option one answer picked: exactly one option, no typed text, and a label the card
 * itself wrote. Anything else picks nothing.
 */
export function chosenOption({
  confirm,
  answers,
}: {
  confirm: UserWaitConfirm;
  answers: unknown;
}): ConfirmChoice {
  if (!Array.isArray(answers) || answers.length !== 1) return NOTHING;
  const [answer] = answers as { selected?: unknown; other?: unknown }[];
  if (typeof answer?.other === "string" && answer.other.trim() !== "") return NOTHING;
  const selected = Array.isArray(answer?.selected) ? answer.selected : [];
  const option = confirm.options.find((each) => each.label === selected[0]);

  return selected.length === 1 && option ? { kind: "option", optionId: option.id } : NOTHING;
}

/** The option a click sent as a message picked, by the id it carries. */
export function selectedOption({
  confirm,
  optionIds,
  otherText,
}: {
  confirm: UserWaitConfirm;
  optionIds: readonly string[];
  otherText?: string | undefined;
}): ConfirmChoice {
  if (otherText !== undefined && otherText.trim() !== "") return NOTHING;
  const [optionId] = optionIds;
  const known = confirm.options.some((option) => option.id === optionId);

  return optionIds.length === 1 && optionId && known ? { kind: "option", optionId } : NOTHING;
}

/** The wait a confirmation card's block id names: the panel mints `question:<waitId>:0` for it. */
export function confirmBlockWait(
  blockId: string,
): { kind: "card"; waitId: string } | { kind: "other" } {
  const waitId = /^question:(.+):0$/.exec(blockId)?.[1];
  return waitId ? { kind: "card", waitId } : { kind: "other" };
}

/** What Langy reads when a request still needs the person's click. */
export function confirmationRefusalMessage({
  action,
  records,
}: {
  action: string;
  records: readonly string[];
}): string {
  return (
    `${gerund(action)} needs a confirmation click. ` +
    `A confirmation card for ${records.join(", ")} is now shown to the user. ` +
    "Wait for their answer; after they choose Yes, run the same command again."
  );
}

/**
 * What Langy reads when every record had its click, yet another request spent one of them first.
 * Nothing new is asked of the person, so it simply runs again.
 */
export function retryRefusalMessage(action: string): string {
  return `${gerund(action)} did not run this time. Run the same command again.`;
}

/** What Langy reads when a click is needed but no card could be put in front of the person. */
export function cardUnavailableRefusalMessage(action: string): string {
  return (
    `${gerund(action)} needs a confirmation click, and no confirmation card could be shown ` +
    "right now. Ask the user to send a message, then run the same command again."
  );
}

/** What Langy reads when its key belongs to no conversation that could show a card. */
export function unboundRefusalMessage(action: string): string {
  return (
    `${gerund(action)} needs a confirmation click, and this key does not belong to a ` +
    "Langy conversation that can show one, so it cannot run."
  );
}

/**
 * How long a card's index entry and its answer claim are kept: past the card's own record, so a
 * click that arrives as a message after the card stopped waiting still finds it.
 */
export const CONFIRM_CARD_TTL_SECONDS = Math.ceil(QUESTION_WAIT_BUDGET_MS / 1000) + 10 * 60;
