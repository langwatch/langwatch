/**
 * The words for a widget that failed on a resource limit. Only the two limit codes have them;
 * every other failure keeps the error registry's own message.
 */

/** Who reads the card, which decides whether the limit is theirs to fix. */
export type WidgetLimitAudience =
  | { readonly kind: "built_in" }
  | {
      readonly kind: "editable";
      /** Absent, with `onEditCode`, when the reader cannot edit the board. */
      readonly onEditWithLangy?: (() => void) | undefined;
      readonly onEditCode?: (() => void) | undefined;
    };

export interface WidgetLimitWords {
  readonly message: string;
  /** Extra line for a reader who cannot change the query. */
  readonly note?: string;
}

const BUILT_IN_MESSAGE =
  "This widget hit a LangWatch limit in the selected period. This is not a problem with your data.";

const EDITABLE_MESSAGE: Readonly<Record<string, string>> = {
  query_memory_exceeded: "The query used more memory than a widget may use.",
  query_timeout: "The query ran past the time a widget may take.",
};

/** Whether `code` is one of the two resource limits that have their own words. */
export function isWidgetLimitFailure(code: string): boolean {
  return code in EDITABLE_MESSAGE;
}

/** The limit wording for `code`, or null when the failure keeps its existing message. */
export function widgetLimitWords({
  code,
  audience,
}: {
  code: string;
  audience: WidgetLimitAudience | undefined;
}): WidgetLimitWords | null {
  const editable = EDITABLE_MESSAGE[code];
  if (!audience || !editable) return null;
  if (audience.kind === "built_in") return { message: BUILT_IN_MESSAGE };
  const canEdit = audience.onEditWithLangy !== undefined || audience.onEditCode !== undefined;
  return canEdit
    ? { message: editable }
    : {
        message: editable,
        note: "Ask someone who can edit this dashboard to change the query.",
      };
}
