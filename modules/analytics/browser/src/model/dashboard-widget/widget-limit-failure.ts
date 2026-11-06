/**
 * The words for a widget that failed on a resource limit. Only the two limit codes have them;
 * every other failure keeps the error registry's own message.
 */

import type { ChartQueryError } from "@langwatch/analytics-contract/chart-frame-protocol";

/** Who reads the card, which decides whether the limit is theirs to fix. */
export type WidgetLimitAudience =
  | { readonly kind: "built_in" }
  | {
      readonly kind: "editable";
      /** Absent, with `onEditCode`, when the reader cannot edit the board. */
      readonly onEditWithLangy?: (() => void) | undefined;
      readonly onEditCode?: (() => void) | undefined;
      /** True while a board write runs, so the edit actions wait for it. */
      readonly editsDisabled?: boolean;
    };

export interface WidgetLimitWords {
  readonly message: string;
  /** Extra line for a reader who cannot change the query. */
  readonly note?: string;
  /** Shown in place of `message` on the smallest cards, where the full words do not fit. */
  readonly shortMessage?: string;
  /** Shown in place of `note` on the smallest cards. */
  readonly shortNote?: string;
}

const BUILT_IN_MESSAGE =
  "This widget hit a LangWatch limit in the selected period. This is not a problem with your data.";

const SHORT_MESSAGE: Readonly<Record<string, string>> = {
  query_memory_exceeded: "Hit the memory limit.",
  query_timeout: "Hit the time limit.",
};

const EDITABLE_MESSAGE: Readonly<Record<string, string>> = {
  query_memory_exceeded: "The query used more memory than a widget may use.",
  query_timeout: "The query ran past the time a widget may take.",
};

/** Whether `code` is one of the two resource limits that have their own words. */
export function isWidgetLimitFailure(code: string): boolean {
  return Object.hasOwn(EDITABLE_MESSAGE, code);
}

/** The limit wording for `code`, or null when the failure keeps its existing message. */
export function widgetLimitWords({
  code,
  audience,
}: {
  code: string;
  audience: WidgetLimitAudience | undefined;
}): WidgetLimitWords | null {
  if (!audience || !isWidgetLimitFailure(code)) return null;
  const editable = EDITABLE_MESSAGE[code] as string;
  if (audience.kind === "built_in") return { message: BUILT_IN_MESSAGE };
  const shortMessage = Object.hasOwn(SHORT_MESSAGE, code) ? SHORT_MESSAGE[code] : undefined;
  const canEdit = audience.onEditWithLangy !== undefined || audience.onEditCode !== undefined;
  return canEdit
    ? { message: editable, ...(shortMessage ? { shortMessage } : {}) }
    : {
        message: editable,
        note: "Ask someone who can edit this dashboard to change the query.",
        ...(shortMessage ? { shortMessage } : {}),
        shortNote: "Ask someone to edit it.",
      };
}

/** A limit failure as the editor preview prints it: the reason, then the registry's remedy. */
export function editorLimitError(error: ChartQueryError): ChartQueryError {
  const reason = isWidgetLimitFailure(error.code) ? EDITABLE_MESSAGE[error.code] : undefined;
  return reason
    ? { ...error, title: "Couldn't load", message: `${reason} ${error.message}` }
    : error;
}
