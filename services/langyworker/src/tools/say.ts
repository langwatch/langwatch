/**
 * The `say` tool: a line said to the user now, where the call happens.
 *
 * A model that writes its reply once its calls are done puts every line at the
 * end of the turn, under the cards, whatever the skill asked for. This tool
 * gives a line a place of its own: the call is a tool part like any other, so
 * it is streamed, recorded and replayed in the order it happened, and the
 * panel draws its text as ordinary reply prose instead of an activity row.
 */

import { Type } from "typebox";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

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

/** The tool result for one call: the text is either shown or refused. */
export function renderSaid(text: unknown): string {
  if (typeof text !== "string" || text.trim() === "") return EMPTY_SAY_PUSHBACK;
  return SAID_RESULT;
}

export function createSayExtension(): InlineExtension {
  return {
    name: "langy-say",
    factory: (pi: ExtensionAPI) => {
      pi.registerTool({
        name: SAY_TOOL_NAME,
        label: "Say",
        description:
          "Show a line to the user now, in place, before the next tool call. The text is drawn as ordinary reply prose where the call happens, so the user reads it before the work that follows. Use it for a line the user must read at that moment: a line a skill asks for before a card or a command, or a result that the reply text would only carry at the end of the turn. Never repeat in the reply what was said with this tool; the reply text can be empty once every line was said.",
        parameters: sayParams,
        async execute(_toolCallId, params) {
          return {
            content: [{ type: "text" as const, text: renderSaid(params.text) }],
            details: {},
          };
        },
      });
    },
  };
}
