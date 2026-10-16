import { HandledError } from "@langwatch/handled-error";

/** Managed keys that accept every call and record nothing. */
export class QuietManagedKeys {
  async issue(): Promise<void> {}
  async retire(): Promise<void> {}
  async invalidate(): Promise<void> {}
  async setConnectServices(): Promise<void> {}
  async setLicense(): Promise<void> {}
}

/** Contract budgets that accept every sync and record nothing. */
export class QuietBudgets {
  async sync(): Promise<void> {}
}

/** The handled error code the work was refused with, or nothing when it succeeded. */
export async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
  const error = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  return HandledError.isHandled(error) ? error.code : undefined;
}
