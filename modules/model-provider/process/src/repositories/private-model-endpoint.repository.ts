/** A private endpoint as stored (ADR-203): one organization's addresses and port. */
export interface PrivateModelEndpointRecord {
  id: string;
  organizationId: string;
  name: string;
  region: string;
  addresses: string[];
  port: number;
  createdById: string | null;
}

/** A hostname an organization bound to one of its own endpoints. */
export interface PrivateModelEndpointBindingRecord {
  id: string;
  organizationId: string;
  endpointId: string;
  hostname: string;
  createdById: string | null;
}

/**
 * The endpoints and bindings model-provider owns. Every read and write names the organization,
 * so another organization's row is never found, and an endpoint leaves with its bindings.
 */
export interface PrivateModelEndpointRepository {
  findEndpoints(input: { organizationId: string }): Promise<PrivateModelEndpointRecord[]>;
  findEndpoint(input: {
    organizationId: string;
    id: string;
  }): Promise<PrivateModelEndpointRecord | null>;
  saveEndpoint(input: PrivateModelEndpointRecord): Promise<PrivateModelEndpointRecord>;
  /** Deletes the endpoint and every binding to it, together. */
  removeEndpoint(input: { organizationId: string; id: string }): Promise<void>;
  findBindings(input: { organizationId: string }): Promise<PrivateModelEndpointBindingRecord[]>;
  findBinding(input: {
    organizationId: string;
    id: string;
  }): Promise<PrivateModelEndpointBindingRecord | null>;
  findBindingByHostname(input: {
    organizationId: string;
    hostname: string;
  }): Promise<PrivateModelEndpointBindingRecord | null>;
  saveBinding(input: PrivateModelEndpointBindingRecord): Promise<PrivateModelEndpointBindingRecord>;
  removeBinding(input: { organizationId: string; id: string }): Promise<void>;
}
