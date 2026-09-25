import type { StateProjectionStore } from "@langwatch/eventing";

import type { ConnectionTeardown } from "./connection-teardown.process.ts";
import type { JoinRequestLifecycle } from "./join-request-lifecycle.process.ts";
import type { SsoDomainProofNotifications } from "./sso-domain-proof-notification.process.ts";

/** Why every stand-in below refuses, in the process's own words. */
export function producerOnly(input: {
  processName: string;
  pipeline: string;
  capability: string;
}): Error {
  return new Error(
    `${input.processName} registered the ${input.pipeline} pipeline as a producer only, so it cannot ${input.capability}. This work belongs to the worker that drains the pipeline.`,
  );
}

/** A projection head that cannot be read or written, because nothing folds here. */
export class ProducerOnlyStateProjectionStore<TState> implements StateProjectionStore<TState> {
  constructor(
    private readonly processName: string,
    private readonly pipeline: string,
    private readonly name: string,
  ) {}

  get(): Promise<never> {
    return Promise.reject(this.refuse(`read the ${this.name} projection`));
  }

  store(): Promise<void> {
    return Promise.reject(this.refuse(`write the ${this.name} projection`));
  }

  private refuse(capability: string): Error {
    return producerOnly({
      processName: this.processName,
      pipeline: this.pipeline,
      capability,
    });
  }
}

/**
 * A guard's repository, refusing every read by name.
 */
export function producerOnlyReads<TRepository extends object>(input: {
  processName: string;
  pipeline: string;
  name: string;
}): TRepository {
  return new Proxy({} as TRepository, {
    get(_target, property) {
      if (typeof property === "symbol") return undefined;
      return () =>
        Promise.reject(
          producerOnly({
            processName: input.processName,
            pipeline: input.pipeline,
            capability: `read ${input.name}.${property}`,
          }),
        );
    },
  });
}

/** The expiry and every join-request notice, refused: this process sends no mail here. */
export class ProducerOnlyJoinRequestLifecycle implements JoinRequestLifecycle {
  constructor(private readonly processName: string) {}

  expireRequest(): Promise<void> {
    return Promise.reject(
      producerOnly({
        processName: this.processName,
        pipeline: "join-requests",
        capability: "expire a join request",
      }),
    );
  }

  prepareNotification(): Promise<void> {
    return Promise.reject(
      producerOnly({
        processName: this.processName,
        pipeline: "join-requests",
        capability: "tell people about a join request",
      }),
    );
  }
}

/** The domain-proof notices, refused: this process sends no mail here. */
export class ProducerOnlySsoDomainProofNotifications implements SsoDomainProofNotifications {
  constructor(private readonly processName: string) {}

  proofWavering(): Promise<void> {
    return this.refuse("tell administrators a domain's proof went missing");
  }

  proofLapsed(): Promise<void> {
    return this.refuse("tell administrators a domain's proof lapsed");
  }

  private refuse(capability: string): Promise<void> {
    return Promise.reject(
      producerOnly({ processName: this.processName, pipeline: "sso-connections", capability }),
    );
  }
}

/** The teardown completion, refused: only the draining process advances it. */
export class ProducerOnlyConnectionTeardown implements ConnectionTeardown {
  constructor(private readonly processName: string) {}

  completeTeardown(): Promise<void> {
    return Promise.reject(
      producerOnly({
        processName: this.processName,
        pipeline: "sso-connections",
        capability: "complete a connection's teardown",
      }),
    );
  }
}

/** The directory move on a finished migration, refused: only the draining process asks for it. */
export class ProducerOnlySsoConnectionDirectoryMove {
  constructor(private readonly processName: string) {}

  migrationFinalized(): Promise<void> {
    return Promise.reject(
      producerOnly({
        processName: this.processName,
        pipeline: "sso-connections",
        capability: "move directory sync onto a replacement connection",
      }),
    );
  }
}
