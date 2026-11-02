import { jsonTokens } from "./json-tokens.ts";

/** JSON as coloured runs, for a `pre` the playground fills: its body editor and its response. */
export function JsonCode({ text }: { text: string }) {
  return jsonTokens({ text }).map((token, index) =>
    token.kind === "plain" ? (
      token.text
    ) : (
      // Runs never reorder: the index is the run's place in the text.
      <span key={index} className={`docs-json-${token.kind}`}>
        {token.text}
      </span>
    ),
  );
}
