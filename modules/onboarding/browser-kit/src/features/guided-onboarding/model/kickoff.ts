/**
 * The kickoff message that hands the guided onboarding to Langy once the
 * tour ends: a typed part the panel renders as the tour card, plus a text
 * brief the model reads. @see specs/langy/langy-guided-onboarding.feature
 */
import {
  GUIDED_PATH_TITLES,
  type GuidedPath,
  guidedPathSchema,
} from "@langwatch/onboarding-contract";
import { z } from "zod";

export const GUIDED_ONBOARDING_KICKOFF_PART_TYPE = "guided-onboarding-kickoff";

export const GUIDED_ONBOARDING_SKILL_NAME = "guided-onboarding";

/**
 * The title of the conversation the kickoff starts. It is set when the
 * conversation is created and it sticks, so the brief never reads as a title
 * in the panel header, the history list or the follow-along link.
 */
export const GUIDED_KICKOFF_CONVERSATION_TITLE = "Getting started";

export const guidedKickoffTourStatusSchema = z.enum(["completed", "skipped", "none"]);
export type GuidedKickoffTourStatus = z.infer<typeof guidedKickoffTourStatusSchema>;

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
  /** The gateway URL an app on this instance points at, with its /v1. */
  gatewayUrl: z.string().optional(),
  /**
   * The virtual key the gateway tour minted, when it minted one: its name,
   * its display prefix and the reveal id that serves its secret once. The
   * secret is never in the brief.
   */
  virtualKeyName: z.string().optional(),
  virtualKeyPreview: z.string().optional(),
  virtualKeyRevealId: z.string().optional(),
});
export type GuidedKickoffInput = z.infer<typeof guidedKickoffInputSchema>;

/** What the tour hands the panel: the input plus the attached conversation, if any. */
export type GuidedKickoff = GuidedKickoffInput & {
  conversationId?: string | null;
};

/** The fields of the input the durable guided state settles, once it starts. */
export const GUIDED_KICKOFF_STATE_FIELDS = [
  "paths",
  "provider",
  "providerModel",
  "gatewayUrl",
  "virtualKeyName",
  "virtualKeyPreview",
  "virtualKeyRevealId",
] as const;
export type GuidedKickoffStateFacts = Pick<
  GuidedKickoffInput,
  (typeof GUIDED_KICKOFF_STATE_FIELDS)[number]
>;

/** The settled fields, read off a guided state view. */
export function guidedKickoffStateFactsOf(
  state: Partial<GuidedKickoffStateFacts>,
): GuidedKickoffStateFacts {
  return {
    paths: state.paths ?? [],
    provider: state.provider,
    providerModel: state.providerModel,
    gatewayUrl: state.gatewayUrl,
    virtualKeyName: state.virtualKeyName,
    virtualKeyPreview: state.virtualKeyPreview,
    virtualKeyRevealId: state.virtualKeyRevealId,
  };
}

export const guidedKickoffPartSchema = z.object({
  type: z.literal(GUIDED_ONBOARDING_KICKOFF_PART_TYPE),
  ...guidedKickoffInputSchema.shape,
});
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
 * The Langy worker recognises a kickoff by this literal and places the
 * guided-onboarding skill ahead of the message on that turn.
 */
export const GUIDED_KICKOFF_BRIEF_OPENER = "Guided onboarding kickoff.";

/**
 * The provider line, with the model named when the provider screen settled
 * on one, so the skill does not have to ask what the user already chose.
 */
function providerLine(input: GuidedKickoffInput): string {
  if (!input.provider) return "Provider: none connected yet";
  const model = input.providerModel ? `, model ${input.providerModel}` : "";
  return `Provider: ${input.provider}${model}`;
}

/** When the tour minted a key, the line carries the reveal id and its instruction. */
function virtualKeyLine(input: GuidedKickoffInput): string {
  if (!input.virtualKeyName || !input.virtualKeyRevealId) {
    return "Virtual key: none minted by the tour";
  }
  const preview = input.virtualKeyPreview ?? "vk-lw-";
  return `Virtual key: ${input.virtualKeyName} is live (preview ${preview}, reveal id ${input.virtualKeyRevealId}). Show it with secret_snippet using this reveal id. Do not list, ask or create keys.`;
}

/**
 * The text the model reads: the opener, then one line per fact so the skill
 * can pick the path, the picks and the provider out without guessing.
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
  lines.push(GUIDED_KICKOFF_BRIEF_OPENER, `Path to set up now: ${describePath(input.path)}`);
  const picks = input.paths.length > 0 ? input.paths : [input.path];
  lines.push(
    `Everything picked, in the order it was picked: ${picks.map(describePath).join(", ")}`,
  );
  lines.push(providerLine(input));
  lines.push(`Organization: ${input.orgName ?? "unknown"}`);
  lines.push(`First name: ${input.firstName ?? "unknown"}`);
  lines.push(`Tour: ${input.tourStatus}`);
  lines.push(
    input.gatewayUrl ? `Gateway: ${input.gatewayUrl}` : "Gateway: none configured on this instance",
  );
  lines.push(virtualKeyLine(input));
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

/** A fact the state does not carry drops its field rather than setting it undefined. */
function settleInput({
  sent,
  facts,
}: {
  sent: GuidedKickoffInput;
  facts: GuidedKickoffStateFacts;
}): GuidedKickoffInput {
  const input = { ...sent };
  for (const field of GUIDED_KICKOFF_STATE_FIELDS) {
    delete input[field];
  }
  for (const [field, value] of Object.entries(facts)) {
    if (value !== undefined) {
      (input as Record<string, unknown>)[field] = value;
    }
  }
  return input;
}

/**
 * The kickoff parts with their state lines settled from `facts`: the typed
 * part carries the settled fields and the brief is rebuilt from them, so the
 * card and the model agree. Null when the parts carry no kickoff.
 */
export function settleGuidedKickoffParts({
  parts,
  facts,
}: {
  parts: readonly unknown[];
  facts: GuidedKickoffStateFacts;
}): unknown[] | null {
  const kickoff = guidedKickoffPartOf(parts);
  if (!kickoff) return null;
  const { type: _type, ...sent } = kickoff;
  const continuation = guidedPathContinuationLine(kickoff.path);
  const continuing = parts.some(
    (part) =>
      typeof (part as { text?: unknown })?.text === "string" &&
      (part as { text: string }).text.startsWith(continuation),
  );
  const [typed, brief] = buildGuidedKickoffParts({
    input: settleInput({ sent, facts }),
    continuing,
  });
  return parts.map((part) => {
    if (parseGuidedKickoffPart(part)) return typed;
    const text = (part as { text?: unknown })?.text;
    return typeof text === "string" && text.includes(GUIDED_KICKOFF_BRIEF_OPENER) ? brief : part;
  });
}

/** A kickoff naming a conversation continues it; one without starts fresh and attaches. */
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
export function guidedTourCardRows(input: GuidedKickoffInput): [label: string, value: string][] {
  const picks = input.paths.length > 0 ? input.paths : [input.path];
  const rows: [string, string][] = [
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
