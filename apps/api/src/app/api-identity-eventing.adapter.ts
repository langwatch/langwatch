import { IdentityEventingPort } from "@langwatch/identity-server";
import type { ApiEventingInfrastructure } from "../platform/infrastructure/api-eventing.infrastructure";

/**
 * The identity ledgers' event stack, over this process's own eventing.
 *
 * Both writers used to reach the platform application's service locator for
 * it and WAIT up to five seconds for the handle to appear, because better-auth
 * builds its storage adapter at module load. This process has no such race: it
 * composes its eventing before its identity graph, so the handle either exists
 * when the adapter is built or the deployment configured no Redis and there is
 * nothing to wait for.
 *
 * Absent is a supported shape and the two ledgers read it differently, which
 * is why both methods answer `null` rather than throwing: the identity ledger
 * stages nothing and returns — the projection catches up when a process that
 * does hold a queue folds the log — and the join-request ledger refuses,
 * because a join request has nowhere to land without one.
 */
export class ApiEventingIdentityAdapter extends IdentityEventingPort {
  static create(eventing: ApiEventingInfrastructure | undefined): ApiEventingIdentityAdapter {
    return new ApiEventingIdentityAdapter(eventing);
  }

  private constructor(private readonly eventing: ApiEventingInfrastructure | undefined) {
    super();
  }

  tryPipelineCommand(input: {
    pipeline: string;
    command: string;
  }): Promise<{ send(data: unknown): Promise<unknown> } | null> {
    const eventSourcing = this.eventing?.eventSourcing;
    if (!eventSourcing?.isEnabled) return Promise.resolve(null);
    try {
      const pipeline = eventSourcing.getPipeline(input.pipeline as never) as unknown as {
        commands: Record<string, { send(data: unknown): Promise<unknown> }>;
      };
      return Promise.resolve(pipeline.commands[input.command] ?? null);
    } catch {
      // An unregistered pipeline is the same answer as no event stack: this
      // process stages nothing for it. Reported by the caller, which knows
      // whether that is a delay or a refusal.
      return Promise.resolve(null);
    }
  }

  tryEventStore<TEvent>(): Promise<{
    storeEvents(
      events: TEvent[],
      context: { tenantId: never },
      aggregateType: never,
    ): Promise<unknown>;
  } | null> {
    const eventSourcing = this.eventing?.eventSourcing;
    if (!eventSourcing?.isEnabled) return Promise.resolve(null);
    return Promise.resolve(
      (eventSourcing.getEventStore as () => unknown)() as {
        storeEvents(
          events: TEvent[],
          context: { tenantId: never },
          aggregateType: never,
        ): Promise<unknown>;
      },
    );
  }
}
