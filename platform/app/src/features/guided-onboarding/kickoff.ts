/**
 * The kickoff message that hands the guided onboarding to Langy once the tour
 * ends. It is an ordinary user message with two parts: a typed part the panel
 * renders as the guided tour card, and a text brief the model reads. The
 * server keeps only text parts when it builds the model's turn, so the typed
 * part never reaches the model and the brief carries everything it needs.
 *
 * Framework-free: the panel, the store and their tests import it.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { z } from "zod";
import {
  GUIDED_PATH_TITLES,
  type GuidedPath,
  guidedPathSchema,
} from "./paths";

export const GUIDED_ONBOARDING_KICKOFF_PART_TYPE = "guided-onboarding-kickoff";

export const GUIDED_ONBOARDING_SKILL_NAME = "guided-onboarding";

export const guidedKickoffTourStatusSchema = z.enum([
  "completed",
  "skipped",
  "none",
]);
export type GuidedKickoffTourStatus = z.infer<
  typeof guidedKickoffTourStatusSchema
>;

/** What the takeover collected, as the tour hands it over. */
export const guidedKickoffInputSchema = z.object({
  path: guidedPathSchema,
  /** Every pick from the value screen, in the order they were made. */
  paths: z.array(guidedPathSchema),
  provider: z.string().optional(),
  providerModel: z.string().optional(),
  orgName: z.string().optional(),
  firstName: z.string().optional(),
  tourStatus: guidedKickoffTourStatusSchema,
});
export type GuidedKickoffInput = z.infer<typeof guidedKickoffInputSchema>;

/** What the tour hands the panel: the input plus the attached conversation, if any. */
export type GuidedKickoff = GuidedKickoffInput & {
  conversationId?: string | null;
};

export const guidedKickoffPartSchema = z
  .object({ type: z.literal(GUIDED_ONBOARDING_KICKOFF_PART_TYPE) })
  .and(guidedKickoffInputSchema);
export type GuidedKickoffPart = z.infer<typeof guidedKickoffPartSchema>;

/** Parse an opaque message part as the kickoff part, or null. */
export function parseGuidedKickoffPart(part: unknown): GuidedKickoffPart | null {
  const parsed = guidedKickoffPartSchema.safeParse(part);
  return parsed.success ? parsed.data : null;
}

/** The kickoff part a message carries, or null when it is not a kickoff. */
export function guidedKickoffPartOf(
  parts: readonly unknown[] | undefined,
): GuidedKickoffPart | null {
  for (const part of parts ?? []) {
    const kickoff = parseGuidedKickoffPart(part);
    if (kickoff) return kickoff;
  }
  return null;
}

/** "Let's set up Gateway then." */
export function guidedPathContinuationLine(path: GuidedPath): string {
  return `Let's set up ${GUIDED_PATH_TITLES[path]} then.`;
}

function describePath(path: GuidedPath): string {
  return `${path} (${GUIDED_PATH_TITLES[path]})`;
}

/**
 * The text the model reads. Structured line by line so the skill can pick
 * the path, the picks and the provider out without guessing, and closed by
 * the instruction to follow the skill.
 */
export function buildGuidedKickoffBrief({
  input,
  continuing = false,
}: {
  input: GuidedKickoffInput;
  continuing?: boolean;
}): string {
  const lines: string[] = [];
  if (continuing) lines.push(guidedPathContinuationLine(input.path));
  lines.push(
    `Guided onboarding kickoff. Follow the ${GUIDED_ONBOARDING_SKILL_NAME} skill.`,
    `Path to set up now: ${describePath(input.path)}.`,
  );
  const picks = input.paths.length > 0 ? input.paths : [input.path];
  lines.push(
    `Everything picked, in the order it was picked: ${picks
      .map(describePath)
      .join(", ")}.`,
  );
  lines.push(
    input.provider
      ? `Provider: ${input.provider}${input.providerModel ? `, model ${input.providerModel}` : ""}.`
      : "Provider: none connected yet.",
  );
  lines.push(
    `Organization: ${input.orgName ?? "unknown"}. First name: ${input.firstName ?? "unknown"}.`,
  );
  lines.push(`Tour: ${input.tourStatus}.`);
  return lines.join("\n");
}

/**
 * The message parts, in the order they are sent: the typed part first so the
 * panel finds it, the brief second so the model reads it.
 */
export function buildGuidedKickoffParts({
  input,
  continuing = false,
}: {
  input: GuidedKickoffInput;
  continuing?: boolean;
}): [GuidedKickoffPart, { type: "text"; text: string }] {
  return [
    { type: GUIDED_ONBOARDING_KICKOFF_PART_TYPE, ...input },
    { type: "text", text: buildGuidedKickoffBrief({ input, continuing }) },
  ];
}

/**
 * What the panel does with a queued kickoff. A kickoff naming a conversation
 * continues it and attaches nothing (the id is already recorded); a kickoff
 * without one starts fresh and is attached to the organization once the
 * transport names the conversation it created.
 */
export function planGuidedKickoffSend({
  kickoff,
  organizationId,
}: {
  kickoff: GuidedKickoff;
  organizationId: string | null;
}): {
  continuing: boolean;
  parts: ReturnType<typeof buildGuidedKickoffParts>;
  brief: string;
  attachToOrganizationId: string | null;
} {
  const { conversationId, ...input } = kickoff;
  const continuing = !!conversationId;
  const parts = buildGuidedKickoffParts({ input, continuing });
  return {
    continuing,
    parts,
    brief: parts[1].text,
    attachToOrganizationId: continuing ? null : organizationId,
  };
}

/**
 * The rows the tour card shows when expanded. "Setting up for" always
 * renders; the picks and the provider only when the takeover recorded them.
 */
export function guidedTourCardRows(
  input: GuidedKickoffInput,
): Array<[label: string, value: string]> {
  const picks = input.paths.length > 0 ? input.paths : [input.path];
  const rows: Array<[string, string]> = [
    ["Setting up for", input.orgName?.trim() || "you"],
    ["You picked", picks.map((path) => GUIDED_PATH_TITLES[path]).join(", ")],
  ];
  if (input.provider) {
    rows.push([
      "Provider",
      `${input.provider}${input.providerModel ? ` · ${input.providerModel}` : ""}`,
    ]);
  }
  return rows;
}
