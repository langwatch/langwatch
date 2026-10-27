/**
 * The failure a check raises when it left engine tables on old credentials because ClickHouse
 * has not shown it holds the app's collection values (#8858).
 * @see specs/lwql/api.feature
 */

/** The error's `type`: what the reconvergence intent recognises it by. */
export const LWQL_COLLECTION_UNCONFIRMED = "LWQL_COLLECTION_UNCONFIRMED";

/** Keeps the probe read's ClickHouse code, so the alert's error_signature names the cause. */
export function collectionUnconfirmedError({
  read,
  engineTables,
  cause,
}: {
  read: string;
  engineTables: number;
  cause: unknown;
}): Error {
  const code = (cause as { code?: unknown } | null)?.code;
  return Object.assign(
    new Error(
      `lwql left ${engineTables} engine table(s) on their current credentials: the ${read} read ` +
        "has not shown ClickHouse holds the app's PostgreSQL credentials",
      { cause },
    ),
    { type: LWQL_COLLECTION_UNCONFIRMED, read, ...(code === undefined ? {} : { code }) },
  );
}

/** Whether a converge failed only because the collection is not yet shown to be loaded. */
export function isCollectionUnconfirmed(error: unknown): boolean {
  return (error as { type?: unknown } | null)?.type === LWQL_COLLECTION_UNCONFIRMED;
}
