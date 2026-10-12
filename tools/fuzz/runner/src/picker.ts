import { z } from "zod";

import { oneOf, type Rng } from "./rng.ts";
import { preview, valueFor, type FuzzValue } from "./values.ts";

/** candidateSchema is one control the page offers, as read from its DOM in document order. */
export const candidateSchema = z.object({
  /** id is the data-fuzz-id the page tagged the element with for this read. */
  id: z.number().int(),
  kind: z.enum(["button", "link", "input", "close"]),
  tag: z.string(),
  text: z.string(),
  href: z.string().optional(),
  inputType: z.string().optional(),
});
export type Candidate = z.infer<typeof candidateSchema>;

export type Action =
  | { kind: "click"; candidate: Candidate }
  | { kind: "link"; candidate: Candidate }
  | { kind: "close"; candidate: Candidate }
  | { kind: "fill"; candidate: Candidate; value: FuzzValue; submit: boolean }
  | { kind: "escape" };

/** Destructive global acts nobody wants a monkey to perform, even in its own org. */
const DESTRUCTIVE_TEXT = [
  /sign[\s-]?out/i,
  /log[\s-]?out/i,
  /delete (?:this |my |the )?(?:organi[sz]ation|account|workspace)/i,
  /leave (?:the |this )?(?:organi[sz]ation|team|workspace)/i,
  /remove (?:me|myself)/i,
  /deactivate|close account/i,
];
const DESTRUCTIVE_HREF = /sign-?out|log-?out/i;

/** isDestructive is true for controls the monkey never touches; extra is the plan's own. */
export const isDestructive = ({
  candidate,
  extra = [],
}: {
  candidate: Pick<Candidate, "text" | "href">;
  extra?: readonly RegExp[];
}): boolean =>
  DESTRUCTIVE_TEXT.some((pattern) => pattern.test(candidate.text)) ||
  DESTRUCTIVE_HREF.test(candidate.href ?? "") ||
  extra.some((pattern) => pattern.test(candidate.text));

const NUMERIC_INPUTS = new Set(["number", "range"]);

/** WEIGHTS are the odds of each family of action on a page with no overlay open. */
const WEIGHTS = { click: 0.55, fill: 0.3, link: 0.15 };
const ESCAPE_ODDS = 0.35;
const CLOSE_ODDS = 0.25;
const SUBMIT_ODDS = 0.3;

/**
 * pickAction chooses the next action from what the page offers, and nothing else: given the
 * same rng stream and the same candidates it returns the same action.
 */
export const pickAction = ({
  rng,
  candidates,
  overlayOpen,
  extraAvoid = [],
}: {
  rng: Rng;
  candidates: readonly Candidate[];
  overlayOpen: boolean;
  extraAvoid?: readonly RegExp[];
}): Action => {
  const usable = candidates.filter((candidate) => !isDestructive({ candidate, extra: extraAvoid }));
  const closers = usable.filter((candidate) => candidate.kind === "close");
  if (overlayOpen) {
    const roll = rng();
    if (roll < ESCAPE_ODDS || usable.length === 0) return { kind: "escape" };
    const closer = oneOf({ rng, items: closers });
    if (roll < ESCAPE_ODDS + CLOSE_ODDS && closer !== undefined) {
      return { kind: "close", candidate: closer };
    }
  }
  const inputs = usable.filter((candidate) => candidate.kind === "input");
  const links = usable.filter((candidate) => candidate.kind === "link");
  const buttons = usable.filter(
    (candidate) => candidate.kind === "button" || candidate.kind === "close",
  );
  const roll = rng();
  if (roll < WEIGHTS.fill && inputs.length > 0) {
    const candidate = oneOf({ rng, items: inputs }) as Candidate;
    const numeric = NUMERIC_INPUTS.has(candidate.inputType ?? "");
    return {
      kind: "fill",
      candidate,
      value: valueFor({ rng, numeric }),
      submit: rng() < SUBMIT_ODDS,
    };
  }
  if (roll < WEIGHTS.fill + WEIGHTS.link && links.length > 0) {
    return { kind: "link", candidate: oneOf({ rng, items: links }) as Candidate };
  }
  const any = buttons.length > 0 ? buttons : usable;
  const candidate = oneOf({ rng, items: any });
  return candidate === undefined ? { kind: "escape" } : { kind: "click", candidate };
};

/** TrailStep is one action as the finding records it: enough to read and to replay by seed. */
export interface TrailStep {
  n: number;
  action: Action["kind"] | "open" | "reload";
  target?: string;
  value?: string;
  url: string;
}

/** trailStep describes an action for a trail. */
export const trailStep = ({
  n,
  action,
  url,
}: {
  n: number;
  action: Action;
  url: string;
}): TrailStep => {
  if (action.kind === "escape") return { n, action: "escape", url };
  const { candidate } = action;
  const target = `${candidate.tag}${candidate.href === undefined ? "" : `[${candidate.href}]`} ${JSON.stringify(candidate.text)}`;
  return {
    n,
    action: action.kind,
    target,
    ...(action.kind === "fill" ? { value: preview(action.value) } : {}),
    url,
  };
};
