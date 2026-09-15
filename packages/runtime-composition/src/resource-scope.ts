import type { RuntimeService } from "./runtime-lifecycle.ts";

export type ResourceCloser = () => void | Promise<void>;

export interface ResourceOwnership {
  own(name: string, close: ResourceCloser): void;
  /** Registers inert work for runtime start; construction allocations still use own(). */
  ownService(service: RuntimeService): void;
}

/** Owns process resources and closes them once in reverse registration order. */
export class ResourceScope {
  private readonly resources: Array<{ name: string; close: ResourceCloser }> = [];
  private closeResult: Promise<void> | undefined;
  private readonly services: RuntimeService[] = [];
  private servicesSealed = false;

  ownService(service: RuntimeService): void {
    const registrationClosed = this.servicesSealed || this.closeResult;
    if (registrationClosed) {
      throw new Error(`Service registration is closed; cannot own "${service.name}".`);
    }

    const name = service.name.trim();
    if (!name) {
      throw new Error("Service names cannot be empty.");
    }

    this.services.push({ name, start: () => service.start(), stop: () => service.stop() });
  }

  sealServices(): readonly RuntimeService[] {
    this.servicesSealed = true;

    return [...this.services];
  }

  own(name: string, close: ResourceCloser): void {
    if (this.closeResult) {
      throw new Error(`Resource scope is closed; cannot own "${name}".`);
    }
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error("Resource names cannot be empty.");
    }
    this.resources.push({ name: normalizedName, close });
  }

  close(): Promise<void> {
    this.closeResult ??= Promise.resolve().then(() => this.closeOwnedResources());
    return this.closeResult;
  }

  private async closeOwnedResources(): Promise<void> {
    const failures: Array<{ name: string; error: unknown }> = [];
    for (const resource of [...this.resources].reverse()) {
      try {
        await resource.close();
      } catch (error) {
        failures.push({ name: resource.name, error });
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map(({ error }) => error),
        `Failed to close runtime resources: ${failures.map(({ name }) => name).join(", ")}`,
      );
    }
  }
}
