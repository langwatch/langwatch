import type {
  ConnectOrganizationRecord,
  ConnectOrganizationRepository,
  OrganizationCustomerRecord,
} from "../connect-organization.repository.ts";

/** The Connect state of each organization on this install, held in memory. */
export class MemoryConnectOrganizationRepository implements ConnectOrganizationRepository {
  #rows: Map<string, ConnectOrganizationRecord>;
  #customers: Map<string, OrganizationCustomerRecord>;

  /** `rows` is shared, not copied: a test writes a licence onto it the way activation does. */
  static create({
    rows = new Map(),
    customers = new Map(),
  }: {
    rows?: Map<string, ConnectOrganizationRecord>;
    customers?: Map<string, OrganizationCustomerRecord>;
  } = {}): MemoryConnectOrganizationRepository {
    return new MemoryConnectOrganizationRepository({ rows, customers });
  }

  private constructor({
    rows,
    customers,
  }: {
    rows: Map<string, ConnectOrganizationRecord>;
    customers: Map<string, OrganizationCustomerRecord>;
  }) {
    this.#rows = rows;
    this.#customers = customers;
  }

  async findById(organizationId: string): Promise<ConnectOrganizationRecord | null> {
    return this.#rows.get(organizationId) ?? null;
  }

  async findCustomer(organizationId: string): Promise<OrganizationCustomerRecord | null> {
    return this.#customers.get(organizationId) ?? null;
  }

  async findLicensedOrganizationIds(): Promise<string[]> {
    return [...this.#rows.values()].filter((row) => row.license).map((row) => row.organizationId);
  }

  /** Seed order stands for creation order. */
  async findAllOldestFirst(): Promise<{ organizationId: string; license: string | null }[]> {
    return [...this.#rows.values()].map((row) => ({
      organizationId: row.organizationId,
      license: row.license,
    }));
  }
}
