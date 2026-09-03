/**
 * What the AI composer answers with when it turns a sentence into a trace
 * query, or into a saved lens.
 *
 * The results live in the contract because the trace transport publishes them
 * and the search bar reads them: a payload type declared in the application
 * would narrow to its declared constraint for every client once the transport
 * moved into a package. The composer itself — the provider calls, the retry
 * loop, the validator — stays where the model providers are.
 */

export type AiQueryResult =
  | { ok: true; query: string; attempts: number }
  | {
      ok: false;
      lastQuery: string;
      lastError: string;
      attempts: number;
    };

/**
 * The AI's higher-level surface — it can either apply a query to the
 * current view, or create a saved lens. The model picks the kind based
 * on the user's intent (phrases like "save as", "view for", "lens for"
 * lean toward `create_lens`; everything else toward `apply_query`).
 */
export type AiActionResult =
  | { ok: true; kind: "apply_query"; query: string }
  | {
      ok: true;
      kind: "create_lens";
      name: string;
      query: string;
    };

/**
 * The operator-actionable fields the composer's "View details" disclosure
 * renders. Stack traces and SDK-internal prefixes are stripped before any of
 * this leaves the server.
 *
 * This is the whole reason these travel in `meta`: `AiErrorDetails`
 * (`features/traces-v2/components/SearchBar/ErrorBannerDetail.tsx`) is the
 * named consumer. Nothing else reads them.
 */
export interface AiActionErrorDetails {
  provider?: string;
  model?: string;
  httpStatus?: number;
  /**
   * Why the last attempt failed, in OUR words — the query validator's own
   * message ("unexpected token at position 12"), set only on the validation
   * exit.
   *
   * Never the provider's response text. `summarizeProviderError` used to fill
   * this by regexing `"message"` out of the failure body, which is the field
   * an OpenAI 401 fills with `Incorrect API key provided: sk-proj-…` — our own
   * key, on a managed provider. The structured fields around it carry the
   * operator-actionable part of a provider failure without any of that risk.
   */
  reason?: string;
  /** The last query the model produced, when it produced one. */
  lastQuery?: string;
}

/**
 * The composer's view of a failure, assembled client-side from whatever
 * arrived. Deliberately carries no prose: `code` selects the registry copy and
 * drives UI branching, `cause` is the error itself so the renderer can call
 * `explainAnyError`, and `details` feeds the disclosure.
 */
export type AiActionError = {
  /**
   * The handled code the failure carried, or `"unknown"` when it carried
   * none. Stable enough to branch and report on.
   *
   * Typed `string` rather than `AppErrorCode` on purpose: it is lifted off the
   * wire, and a client cannot assume the server it is talking to enumerates
   * exactly the codes it knows. An unrecognised one degrades in
   * `explainAnyError` rather than being a type error here.
   */
  code: string;
  /**
   * The failure as it arrived, so the UI resolves its words through
   * `explainAnyError` rather than rendering a sentence the server chose.
   */
  cause?: unknown;
  /** Optional structured detail rendered in the disclosure. */
  details?: AiActionErrorDetails;
};
