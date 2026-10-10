/**
 * The docs link and trace id an error toast carries on its `meta`.
 */

export type UiErrorActionsProps = {
  /** Canonical docs page for this error, when the server sent one. */
  docsUrl?: string;
  /** The trace id, offered as a copyable support handle. */
  traceId?: string;
};

/** Reads the docs link and trace id a failure toast carried on its `meta`. */
export function readUiErrorActions(meta: Record<string, unknown> | undefined): UiErrorActionsProps {
  return {
    ...(typeof meta?.docsUrl === "string" ? { docsUrl: meta.docsUrl } : {}),
    ...(typeof meta?.traceId === "string" ? { traceId: meta.traceId } : {}),
  };
}
