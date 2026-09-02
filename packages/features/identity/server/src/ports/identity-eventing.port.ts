/**
 * The event-sourcing stack the two identity ledgers append through.
 *
 * Both writers used to reach a service locator for it — `tryGetApp()`, waited
 * on for five seconds because better-auth builds its storage adapter at module
 * load, before any application exists. That wait was the locator's problem
 * rather than the ledger's: a process that composes its eventing before its
 * identity graph has the handle already, and one that never composes eventing
 * should say so rather than sleep and then fail.
 *
 * So the handle arrives as this port. `try…` on both methods for the same
 * reason it was optional behind the locator: a deployment may run with the
 * event stack disabled, and the caller decides what that means — the identity
 * ledger stages nothing and returns, the join-request ledger refuses, because
 * one is a projection catching up and the other is a command with nowhere to
 * land.
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

  /**
   * The append-only store the join-request ledger writes its facts to, or
   * `null` when this process composed no event stack.
   */
  abstract tryEventStore<TEvent>(): Promise<{
    storeEvents(
      events: TEvent[],
      context: { tenantId: never },
      aggregateType: never,
    ): Promise<unknown>;
  } | null>;
}
