export type ResourceCloser = () => void | Promise<void>;

export class ResourceScope {
  private readonly resources: Array<{ name: string; close: ResourceCloser }> =
    [];
  private closed = false;

  own(name: string, close: ResourceCloser): void {
    if (this.closed) {
      throw new Error(`Resource scope is closed; cannot own "${name}".`);
    }
    this.resources.push({ name, close });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
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
