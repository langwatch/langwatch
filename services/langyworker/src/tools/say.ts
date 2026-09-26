/**
 * The `say` tool: a line said to the user now, where the call happens.
 *
 * A model that writes its reply once its calls are done puts every line at the
 * end of the turn, under the cards, whatever the skill asked for. This tool
 * gives a line a place of its own: the call is a tool part like any other, so
 * it is streamed, recorded and replayed in the order it happened, and the
 * panel draws its text as ordinary reply prose instead of an activity row.
 *
 * A rule handed in at creation can refuse a line: the tool then throws the
 * rule's own words, pi records the call as errored, and the panel draws
 * nothing for a say that errored. Two rules apply: the guided path's closing
 * line before the complete-path command (guided-turn-end.ts), and a line
 * already said in the turn (below).
 */

import { Type } from "typebox";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { SettledCall } from "./turn-context.js";

export const SAY_TOOL_NAME = "say";

/** What the model reads back once the line is on screen. */
export const SAID_RESULT = "Said.";

/** What the model reads when it called the tool with nothing to say. */
export const EMPTY_SAY_PUSHBACK =
  "Nothing was said: the text is empty. Call say with the line to show.";

const sayParams = Type.Object({
  text: Type.String({
    description:
      "The line or paragraph to show, in markdown. It is drawn as your own words, in place.",
  }),
});

/** What `say` answers to a line already said in the turn. */
export const REPEATED_LINE_PUSHBACK = "Already said; do not repeat it. Go on with the step.";

/** The tool result for one call: the text is either shown or refused. */
export function renderSaid(text: unknown): string {
  if (typeof text !== "string" || text.trim() === "") return EMPTY_SAY_PUSHBACK;
  return SAID_RESULT;
}

/** A line as it is compared for repeats: the ends trimmed, runs of whitespace folded to one space. */
function foldWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * The repeat rule: a line already said in this turn, whitespace aside, is
 * refused and draws nothing. Only the turn's own settled says count, so a
 * later turn may say the line again, and only the ones that were drawn: a
 * say the rules refused was never said. The skill's rule is never to say a
 * line twice; a step 2 block said twice in a row drew twice on film.
 */
export function repeatedLineRefusal({
  text,
  calls,
}: {
  text: string;
  calls: readonly SettledCall[];
}): string | undefined {
  const line = foldWhitespace(text);
  const said = calls.some((call) => {
    if (call.name !== SAY_TOOL_NAME || call.isError) return false;
    const previous = (call.input as { text?: unknown } | null)?.text;
    return typeof previous === "string" && foldWhitespace(previous) === line;
  });
  return said ? REPEATED_LINE_PUSHBACK : undefined;
}

/** A rule over a line about to be said: the words of the refusal, or undefined to let it through. */
export type SayRefusal = (text: string) => string | undefined;

export function createSayExtension({ refuse }: { refuse?: SayRefusal } = {}): InlineExtension {
  return {
    name: "langy-say",
    factory: (pi: ExtensionAPI) => {
      pi.registerTool({
        name: SAY_TOOL_NAME,
        label: "Say",
        description:
          "Show a line to the user now, in place, before the next tool call. The text is drawn as ordinary reply prose where the call happens, so the user reads it before the work that follows. Use it for a line the user must read at that moment: a line a skill asks for before a card or a command, or a result that the reply text would only carry at the end of the turn. Never repeat in the reply what was said with this tool; the reply text can be empty once every line was said. A line said against a rule of the running skill is refused with the rule, and nothing is drawn.",
        parameters: sayParams,
        async execute(_toolCallId, params) {
          const text = typeof params.text === "string" ? params.text : "";
          const refused = text.trim() === "" ? undefined : refuse?.(text);
          if (refused !== undefined) throw new Error(refused);
          return {
            content: [{ type: "text" as const, text: renderSaid(params.text) }],
            details: {},
          };
        },
      });
    },
  };
}
