import { checkInstance, Instance } from "./instance.ts";
import type { Ksuid } from "./ksuid.ts";
import { getRandomBytes } from "./platform.ts";
import type { KsuidComponents } from "./types.ts";
import { checkPrefix, checkNonEmptyString } from "./validation.ts";

// Factory function to create Ksuid instances
export type KsuidFactory = (components: KsuidComponents) => Ksuid;

export class Node {
  private _environment: string;
  private _instance: Instance;
  private _lastTimestamp = 0;
  private _currentSequence = 0;
  private _ksuidFactory: KsuidFactory;

  constructor(environment = "prod", instance?: Instance, ksuidFactory?: KsuidFactory) {
    this._environment = environment;
    this._instance = instance ?? this.createInstance();
    this._ksuidFactory = ksuidFactory ?? this.defaultKsuidFactory.bind(this);
  }

  get environment(): string {
    return this._environment;
  }

  set environment(value: string) {
    checkPrefix("environment", value);
    this._environment = value;
  }

  get instance(): Instance {
    return this._instance;
  }

  set instance(value: Instance) {
    checkInstance("instance", value);
    this._instance = value;
  }

  generate(resource: string): Ksuid {
    checkNonEmptyString("resource", resource);

    const now = Math.floor(Date.now() / 1000);

    if (this._lastTimestamp === now) {
      this._currentSequence += 1;
    } else {
      this._lastTimestamp = now;
      this._currentSequence = 0;
    }

    return this._ksuidFactory({
      environment: this._environment,
      resource,
      timestamp: this._lastTimestamp,
      instance: this._instance,
      sequenceId: this._currentSequence,
    });
  }

  private defaultKsuidFactory(_components: KsuidComponents): Ksuid {
    throw new Error("Ksuid factory not initialized");
  }

  private createInstance(): Instance {
    return new Instance(Instance.schemes.RANDOM, getRandomBytes(8));
  }
}
