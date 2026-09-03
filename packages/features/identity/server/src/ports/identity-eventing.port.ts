/**
 * The event-sourcing stack every identity ledger STAGES through.
 *
 * The writers used to reach a service locator for it — `tryGetApp()`, waited
 * on for five seconds because better-auth builds its storage adapter at module
 * load, before any application exists. That wait was the locator's problem
 * rather than the ledger's: a process that composes its eventing before its
 * identity graph has the handle already, and one that never composes eventing
 * should say so rather than sleep and then fail.
 *
 * ONE method, and that is the doctrine rather than a small surface. Under
 * ADR-110 the queued run is the sole appender: it re-executes the same guard
 * the calling path ran and appends what it decides, so a ledger that appended
 * here as well would write every fact twice. The port used to carry a
 * `tryEventStore` beside this, which is what let one ledger keep the older
 * order — and on the tier those ledgers actually run, a producer, that append
 * was refused by name and took the whole ceremony with it. With no seam there
 * is no way back into it.
 *
 * `try…` because a deployment may run with the event stack disabled, and the
 * caller decides what that means. Three of the four ledgers refuse by name: a
 * command with nowhere to land is a failed ceremony, not a quiet one. The
 * directory-sync ledger is the exception and says why in its own docblock — an
 * identity provider's push must not fail because its history could not be
 * written — so it records the loss at `error`, naming the missing
 * registration, and lets the push through.
 */
export abstract class IdentityEventingPort {
  /**
   * The named command sender on one pipeline, or `null` when this process
   * composed no event stack (or the pipeline is not registered on it).
   */
  abstract tryPipelineCommand(input: {
    pipeline: string;
    command: string;
  }): Promise<{ send(data: unknown): Promise<unknown> } | null>;
}
