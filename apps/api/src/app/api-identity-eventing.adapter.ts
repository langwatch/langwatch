import { IdentityEventingPort } from "@langwatch/identity-server";
import type { ApiIdentityPipelines } from "./api-identity-pipelines.composition";

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
 * THE SENDERS ARE RESOLVED AT BOOT, not looked up per send.
 * {@link ApiIdentityPipelines} registers `identity`, `join-requests` and
 * `sso-connections` producer-only on this process's runtime and reads every
 * command dispatcher out of the registration, so a command a ledger names that
 * the definition no longer declares fails this process's boot rather than one
 * person's ceremony. Before that composition existed this method answered
 * `null` for all three, which the identity ledger and the join-request ledger
 * both turn into a thrown "the pipeline exposes no sender" — a write that
 * arrives here and cannot leave.
 *
 * Absent is still a supported shape, and it is the empty registry: a
 * deployment with no queue registers nothing and every ledger refuses by name,
 * which is the honest answer for a process that cannot enqueue.
 *
 * There is no event store here, and there is no seam for one. Under ADR-110
 * the queued run appends; this tier only sends. The adapter used to publish
 * the process's store as well, which is how one ledger came to append on the
 * calling path — against `EventStoreProducerOnly`, which refuses by name, so
 * every join verb failed at the door.
 */
export class ApiEventingIdentityAdapter extends IdentityEventingPort {
  static create(input: {
    /** The senders read out of this process's own producer registrations. */
    pipelines: ApiIdentityPipelines;
  }): ApiEventingIdentityAdapter {
    return new ApiEventingIdentityAdapter(input.pipelines);
  }

  private constructor(private readonly pipelines: ApiIdentityPipelines) {
    super();
  }

  tryPipelineCommand(input: {
    pipeline: string;
    command: string;
  }): Promise<{ send(data: unknown): Promise<unknown> } | null> {
    return Promise.resolve(this.pipelines.tryCommand(input));
  }
}
