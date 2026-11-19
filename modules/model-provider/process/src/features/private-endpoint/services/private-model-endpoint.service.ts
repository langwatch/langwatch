import {
  PrivateModelEndpointInvalidError,
  PrivateModelEndpointNotFoundError,
  type OrganizationPrivateModelEndpoint,
  type PrivateEndpointBindingWire,
  type PrivateModelEndpointBinding,
  type PrivateModelEndpointBindInput,
  type PrivateModelEndpointRebindInput,
  type PrivateModelEndpointRegisterInput,
  type PrivateModelEndpointRemoveInput,
  type PrivateModelEndpointUnbindInput,
  type PrivateModelEndpointUpdateInput,
  type StaffPrivateModelEndpoint,
} from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type {
  PrivateModelEndpointBindingRecord,
  PrivateModelEndpointRecord,
  PrivateModelEndpointRepository,
} from "../../../repositories/private-model-endpoint.repository.ts";
import {
  normalizeBindingHostname,
  normalizeEndpointAddresses,
  normalizeEndpointLabel,
  validateEndpointPort,
} from "../../../rules/private-model-endpoint.rules.ts";

/** How the service mints a row id. */
interface PrivateModelEndpointIds {
  generate(input: Readonly<{ type: "private_endpoint" | "private_endpoint_binding" }>): string;
}

/**
 * Private model endpoints (ADR-203): staff own the addresses, organizations own the names. An
 * endpoint or binding is only ever found inside its own organization; anything else is not found.
 */
export class PrivateModelEndpointService {
  readonly #repository: PrivateModelEndpointRepository;
  readonly #ids: PrivateModelEndpointIds;
  readonly #projects: ProjectApi;

  private constructor(deps: {
    repository: PrivateModelEndpointRepository;
    ids: PrivateModelEndpointIds;
    projects: ProjectApi;
  }) {
    this.#repository = deps.repository;
    this.#ids = deps.ids;
    this.#projects = deps.projects;
  }

  static create(deps: {
    repository: PrivateModelEndpointRepository;
    ids: PrivateModelEndpointIds;
    projects: ProjectApi;
  }): PrivateModelEndpointService {
    return new PrivateModelEndpointService(deps);
  }

  // ── what model calls carry ────────────────────────────────────────────────

  /** The organization's bindings in the wire shape, sorted by hostname; empty when none. */
  async bindingsForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PrivateEndpointBindingWire[]> {
    const bindings = await this.#repository.findBindings({ organizationId });
    if (bindings.length === 0) return [];
    const endpoints = new Map(
      (await this.#repository.findEndpoints({ organizationId })).map((row) => [row.id, row]),
    );

    return bindings.flatMap((binding) => {
      const endpoint = endpoints.get(binding.endpointId);
      if (!endpoint || endpoint.addresses.length === 0) return [];
      return [{ hostname: binding.hostname, addresses: endpoint.addresses, port: endpoint.port }];
    });
  }

  /** The bindings of the organization a project belongs to; empty for an unknown project. */
  async bindingsForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<PrivateEndpointBindingWire[]> {
    const organizationId = await this.#projects.findOrganizationId(projectId);
    return organizationId ? this.bindingsForOrganization({ organizationId }) : [];
  }

  // ── organization managers ─────────────────────────────────────────────────

  async listForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationPrivateModelEndpoint[]> {
    return (await this.#listWithBindings({ organizationId })).map(({ endpoint, bindings }) =>
      organizationView(endpoint, bindings),
    );
  }

  async bind(
    input: PrivateModelEndpointBindInput & { actorId: string },
  ): Promise<PrivateModelEndpointBinding> {
    const hostname = normalizeBindingHostname(input.hostname);
    await this.#requireEndpoint({ organizationId: input.organizationId, id: input.endpointId });
    await this.#refuseTakenHostname({ organizationId: input.organizationId, hostname });

    const saved = await this.#repository.saveBinding({
      id: this.#ids.generate({ type: "private_endpoint_binding" }),
      organizationId: input.organizationId,
      endpointId: input.endpointId,
      hostname,
      createdById: input.actorId,
    });
    return bindingView(saved);
  }

  async rebind(input: PrivateModelEndpointRebindInput): Promise<PrivateModelEndpointBinding> {
    const organizationId = input.organizationId;
    const existing = await this.#requireBinding({ organizationId, id: input.bindingId });
    const hostname = normalizeBindingHostname(input.hostname);
    await this.#requireEndpoint({ organizationId, id: input.endpointId });
    await this.#refuseTakenHostname({ organizationId, hostname, exceptId: existing.id });

    const saved = await this.#repository.saveBinding({
      ...existing,
      endpointId: input.endpointId,
      hostname,
    });
    return bindingView(saved);
  }

  async unbind(input: PrivateModelEndpointUnbindInput): Promise<void> {
    const binding = await this.#requireBinding({
      organizationId: input.organizationId,
      id: input.bindingId,
    });
    await this.#repository.removeBinding({ organizationId: input.organizationId, id: binding.id });
  }

  // ── staff ─────────────────────────────────────────────────────────────────

  async listForStaff({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<StaffPrivateModelEndpoint[]> {
    return (await this.#listWithBindings({ organizationId })).map(({ endpoint, bindings }) =>
      staffView(endpoint, bindings),
    );
  }

  async register(
    input: PrivateModelEndpointRegisterInput & { actorId: string },
  ): Promise<StaffPrivateModelEndpoint> {
    const saved = await this.#repository.saveEndpoint({
      id: this.#ids.generate({ type: "private_endpoint" }),
      organizationId: input.organizationId,
      ...endpointFields(input),
      createdById: input.actorId,
    });
    return staffView(saved, []);
  }

  async update(input: PrivateModelEndpointUpdateInput): Promise<StaffPrivateModelEndpoint> {
    const organizationId = input.organizationId;
    const existing = await this.#requireEndpoint({ organizationId, id: input.endpointId });
    const saved = await this.#repository.saveEndpoint({ ...existing, ...endpointFields(input) });
    const bindings = (await this.#repository.findBindings({ organizationId })).filter(
      (binding) => binding.endpointId === saved.id,
    );
    return staffView(saved, bindings);
  }

  async remove(input: PrivateModelEndpointRemoveInput): Promise<void> {
    const endpoint = await this.#requireEndpoint({
      organizationId: input.organizationId,
      id: input.endpointId,
    });
    await this.#repository.removeEndpoint({
      organizationId: input.organizationId,
      id: endpoint.id,
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  async #listWithBindings({ organizationId }: { organizationId: string }) {
    const [endpoints, bindings] = await Promise.all([
      this.#repository.findEndpoints({ organizationId }),
      this.#repository.findBindings({ organizationId }),
    ]);
    return endpoints.map((endpoint) => ({
      endpoint,
      bindings: bindings.filter((binding) => binding.endpointId === endpoint.id),
    }));
  }

  async #requireEndpoint(input: {
    organizationId: string;
    id: string;
  }): Promise<PrivateModelEndpointRecord> {
    const endpoint = await this.#repository.findEndpoint(input);
    if (!endpoint) throw new PrivateModelEndpointNotFoundError();
    return endpoint;
  }

  async #requireBinding(input: {
    organizationId: string;
    id: string;
  }): Promise<PrivateModelEndpointBindingRecord> {
    const binding = await this.#repository.findBinding(input);
    if (!binding) throw new PrivateModelEndpointNotFoundError();
    return binding;
  }

  async #refuseTakenHostname({
    organizationId,
    hostname,
    exceptId,
  }: {
    organizationId: string;
    hostname: string;
    exceptId?: string;
  }): Promise<void> {
    const taken = await this.#repository.findBindingByHostname({ organizationId, hostname });
    if (!taken || taken.id === exceptId) return;
    const reason = `${hostname} is already bound in this organization.`;
    throw new PrivateModelEndpointInvalidError({ field: "hostname", reason });
  }
}

/** The staff-owned fields, each validated; a refusal names its field. */
function endpointFields(input: {
  name: string;
  region: string;
  addresses: readonly string[];
  port: number;
}): Pick<PrivateModelEndpointRecord, "name" | "region" | "addresses" | "port"> {
  return {
    name: normalizeEndpointLabel({ field: "name", value: input.name }),
    region: normalizeEndpointLabel({ field: "region", value: input.region }),
    addresses: normalizeEndpointAddresses(input.addresses),
    port: validateEndpointPort(input.port),
  };
}

function bindingView(binding: PrivateModelEndpointBindingRecord): PrivateModelEndpointBinding {
  return { id: binding.id, endpointId: binding.endpointId, hostname: binding.hostname };
}

/** What an organization reads: never the addresses or the port. */
function organizationView(
  endpoint: PrivateModelEndpointRecord,
  bindings: readonly PrivateModelEndpointBindingRecord[],
): OrganizationPrivateModelEndpoint {
  return {
    id: endpoint.id,
    name: endpoint.name,
    region: endpoint.region,
    status: bindings.length > 0 ? "in_use" : "unbound",
    bindings: bindings.map(bindingView),
  };
}

function staffView(
  endpoint: PrivateModelEndpointRecord,
  bindings: readonly PrivateModelEndpointBindingRecord[],
): StaffPrivateModelEndpoint {
  return {
    ...organizationView(endpoint, bindings),
    organizationId: endpoint.organizationId,
    addresses: [...endpoint.addresses],
    port: endpoint.port,
  };
}
