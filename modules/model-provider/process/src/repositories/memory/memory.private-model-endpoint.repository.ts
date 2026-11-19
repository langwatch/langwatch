import type {
  PrivateModelEndpointBindingRecord,
  PrivateModelEndpointRecord,
  PrivateModelEndpointRepository,
} from "../private-model-endpoint.repository.ts";

/** The twin of the (organizationId, hostname) unique index refusing a second binding. */
export class MemoryBindingHostnameTakenError extends Error {
  constructor(hostname: string) {
    super(`hostname "${hostname}" is already bound in this organization`);
    this.name = "MemoryBindingHostnameTakenError";
  }
}

/** The in-memory twin: the same organization fence and the same cascade as Postgres. */
export class MemoryPrivateModelEndpointRepository implements PrivateModelEndpointRepository {
  readonly #endpoints = new Map<string, PrivateModelEndpointRecord>();
  readonly #bindings = new Map<string, PrivateModelEndpointBindingRecord>();

  static create(): MemoryPrivateModelEndpointRepository {
    return new MemoryPrivateModelEndpointRepository();
  }

  private constructor() {}

  findEndpoints({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PrivateModelEndpointRecord[]> {
    return Promise.resolve(
      [...this.#endpoints.values()]
        .filter((row) => row.organizationId === organizationId)
        .map((row) => ({ ...row, addresses: [...row.addresses] })),
    );
  }

  findEndpoint({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }): Promise<PrivateModelEndpointRecord | null> {
    const row = this.#endpoints.get(id);
    return Promise.resolve(
      row?.organizationId === organizationId ? { ...row, addresses: [...row.addresses] } : null,
    );
  }

  saveEndpoint(input: PrivateModelEndpointRecord): Promise<PrivateModelEndpointRecord> {
    const row = { ...input, addresses: [...input.addresses] };
    this.#endpoints.set(row.id, row);
    return Promise.resolve({ ...row, addresses: [...row.addresses] });
  }

  removeEndpoint({ organizationId, id }: { organizationId: string; id: string }): Promise<void> {
    if (this.#endpoints.get(id)?.organizationId === organizationId) {
      this.#endpoints.delete(id);
      for (const binding of this.#bindings.values()) {
        if (binding.organizationId === organizationId && binding.endpointId === id) {
          this.#bindings.delete(binding.id);
        }
      }
    }
    return Promise.resolve();
  }

  findBindings({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PrivateModelEndpointBindingRecord[]> {
    return Promise.resolve(
      [...this.#bindings.values()]
        .filter((row) => row.organizationId === organizationId)
        .toSorted((left, right) => left.hostname.localeCompare(right.hostname))
        .map((row) => ({ ...row })),
    );
  }

  findBinding({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }): Promise<PrivateModelEndpointBindingRecord | null> {
    const row = this.#bindings.get(id);
    return Promise.resolve(row?.organizationId === organizationId ? { ...row } : null);
  }

  findBindingByHostname({
    organizationId,
    hostname,
  }: {
    organizationId: string;
    hostname: string;
  }): Promise<PrivateModelEndpointBindingRecord | null> {
    const row = [...this.#bindings.values()].find(
      (binding) => binding.organizationId === organizationId && binding.hostname === hostname,
    );
    return Promise.resolve(row ? { ...row } : null);
  }

  saveBinding(
    input: PrivateModelEndpointBindingRecord,
  ): Promise<PrivateModelEndpointBindingRecord> {
    const taken = [...this.#bindings.values()].some(
      (row) =>
        row.id !== input.id &&
        row.organizationId === input.organizationId &&
        row.hostname === input.hostname,
    );
    if (taken) return Promise.reject(new MemoryBindingHostnameTakenError(input.hostname));
    this.#bindings.set(input.id, { ...input });
    return Promise.resolve({ ...input });
  }

  isHostnameTaken(error: unknown): boolean {
    return error instanceof MemoryBindingHostnameTakenError;
  }

  removeBinding({ organizationId, id }: { organizationId: string; id: string }): Promise<void> {
    if (this.#bindings.get(id)?.organizationId === organizationId) this.#bindings.delete(id);
    return Promise.resolve();
  }
}
