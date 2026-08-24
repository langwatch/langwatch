/** Pending record mutations shared by Dataset editor state and its transport. */
export type PendingSavedChanges = Record<
  string,
  Record<string, Record<string, unknown>>
>;
