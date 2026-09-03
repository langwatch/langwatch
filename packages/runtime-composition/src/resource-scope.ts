export type ResourceCloser = () => void | Promise<void>;

/** Owns process resources and closes them once in reverse registration order. */
export class ResourceScope {
  private readonly resources: Array<{ name: string; close: ResourceCloser }> = [];
  private closeResult: Promise<void> | undefined;

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
    this.closeResult ??= this.closeOwnedResources();
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
