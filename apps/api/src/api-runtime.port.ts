import type { ResourceScope } from "@langwatch/runtime-composition";

export type ApiShutdownOptions = {
  terminating?: boolean;
};

/** The complete application graph owned by an API process. */
export abstract class ApiApplicationPort<Application> {
  abstract readonly application: Application;

  abstract compose(): Promise<void>;

  abstract start(): Promise<void>;

  abstract close(options?: ApiShutdownOptions): Promise<void>;
}

/** The explicit API composition phase, kept separate from product application types. */
export abstract class ApiLifecyclePort<Services> {
  abstract compose(resources: ResourceScope): Promise<Services>;
}
