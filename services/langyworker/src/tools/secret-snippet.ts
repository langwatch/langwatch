/**
 * The `secret_snippet` tool: Langy shows a secret once, without holding it.
 *
 * A virtual key minted with `--reveal-once` answers with a reveal id and never
 * the secret. This tool takes that id and a snippet template, and the panel
 * renders the secret snippet card off the call: the card reads the secret
 * once from the app, straight into the reader's screen. Nothing here talks to
 * the app, because the worker has nothing to fetch. The value never enters
 * the tool result, the model's text, the events or the projection.
 *
 * Spec: specs/langy/langy-secret-snippet.feature
 */

import { Type } from "typebox";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

export const SECRET_SNIPPET_TOOL_NAME = "secret_snippet";

/** The placeholder the card fills with the secret. */
export const SECRET_PLACEHOLDER = "{{secret}}";

/** What the model reads when the card went up. */
export const SECRET_SNIPPET_SHOWN =
  "The secret snippet card is shown to the user, with the key filled in. Never print the key yourself.";

/** What the model reads when it sent no usable reveal id. */
export const MISSING_REVEAL_ID_PUSHBACK =
  "No reveal id was given. Pass the reveal id the create command printed (reveal_id) or the one after `reveal` in the brief.";

/** What the model reads when the template has nowhere to put the secret. */
export const MISSING_PLACEHOLDER_PUSHBACK = `The template has no ${SECRET_PLACEHOLDER} placeholder, so the card has nowhere to put the key. Put ${SECRET_PLACEHOLDER} where the secret goes.`;

const secretSnippetParams = Type.Object({
  revealId: Type.String({
    description:
      "The one-time reveal id of the secret: the reveal_id a create with --reveal-once printed, or the id after `reveal` in the brief.",
  }),
  template: Type.String({
    description: `The snippet as the user copies it, with ${SECRET_PLACEHOLDER} where the secret goes, for example: export OPENAI_BASE_URL="https://gateway.example/v1"\\nexport OPENAI_API_KEY="${SECRET_PLACEHOLDER}"`,
  }),
  preview: Type.Optional(
    Type.String({
      description:
        "The key's display prefix, such as vk-lw-01HZX9N, shown in place of the secret once it can no longer be read. From the create output (preview) or the brief.",
    }),
  ),
});

export type SecretSnippetArgs = {
  revealId: string;
  template: string;
  preview?: string;
};

/**
 * What the tool answers, from the arguments alone. Exported so the answer is
 * pinned without a pi session.
 */
export function answerSecretSnippet(params: unknown): string {
  const args = (params ?? {}) as Partial<SecretSnippetArgs>;
  if (typeof args.revealId !== "string" || args.revealId.trim() === "") {
    return MISSING_REVEAL_ID_PUSHBACK;
  }
  if (typeof args.template !== "string" || !args.template.includes(SECRET_PLACEHOLDER)) {
    return MISSING_PLACEHOLDER_PUSHBACK;
  }
  return SECRET_SNIPPET_SHOWN;
}

export function createSecretSnippetExtension(): InlineExtension {
  return {
    name: "langy-secret-snippet",
    factory: (pi: ExtensionAPI) => {
      pi.registerTool({
        name: SECRET_SNIPPET_TOOL_NAME,
        label: "Secret snippet",
        description: `Show the user a snippet with a secret filled in, once, in a card. Use it for any value a create printed a reveal id for instead of the value itself, such as a virtual key made with --reveal-once. Pass the reveal id and the snippet with ${SECRET_PLACEHOLDER} where the secret goes. The card shows the secret; you never see it, and you never print a value that starts with vk-lw- in a message.`,
        parameters: secretSnippetParams,
        async execute(_toolCallId, params) {
          return {
            content: [{ type: "text" as const, text: answerSecretSnippet(params) }],
            details: {},
          };
        },
      });
    },
  };
}
