/**
 * In-memory stand-ins for the registry's ports, shared by its unit tests.
 */
import type {
  ConnectManagedKeyPort,
  CustomerOrganizationPort,
  IssuedLicenseRecord,
  IssuedLicenseRepository,
} from "../licenseRegistry.service";

export class InMemoryIssuedLicenseRepository
  implements IssuedLicenseRepository
{
  rows: IssuedLicenseRecord[] = [];
  private sequence = 0;

  constructor(private readonly now: Date = new Date(0)) {}

  async create(
    data: Omit<IssuedLicenseRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<IssuedLicenseRecord> {
    // The same unique columns the table has.
    const clashes = this.rows.some(
      (row) =>
        row.tokenHash === data.tokenHash ||
        row.licenseId === data.licenseId ||
        (data.replacesId !== null && row.replacesId === data.replacesId),
    );
    if (clashes) {
      throw Object.assign(new Error("unique violation"), { code: "P2002" });
    }
    const row: IssuedLicenseRecord = {
      ...data,
      id: `il_${++this.sequence}`,
      createdAt: this.now,
      updatedAt: this.now,
    };
    this.rows.push(row);
    return { ...row };
  }

  // Reads hand out copies, as a database does: a caller holding a row does
  // not see a write that happened after its read.
  async findById(id: string) {
    const row = this.rows.find((candidate) => candidate.id === id);
    return row ? { ...row } : null;
  }

  async findByTokenHash(tokenHash: string) {
    const row = this.rows.find(
      (candidate) => candidate.tokenHash === tokenHash,
    );
    return row ? { ...row } : null;
  }

  async findAll() {
    return { rows: [...this.rows], total: this.rows.length };
  }

  async update(id: string, data: Partial<IssuedLicenseRecord>) {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) throw new Error("row not found");
    Object.assign(row, data);
    return { ...row };
  }

  // Conditional writes decide on the stored row, as the table does, so a test
  // can race two callers that both read the row before either wrote.
  async bindInstance({
    id,
    instanceId,
    at,
  }: {
    id: string;
    instanceId: string;
    at: Date;
  }) {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || row.instanceId !== null) return false;
    row.instanceId = instanceId;
    row.instanceBoundAt = at;
    return true;
  }

  async attachVirtualKey({
    id,
    virtualKeyId,
  }: {
    id: string;
    virtualKeyId: string;
  }) {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row || row.virtualKeyId !== null) return false;
    row.virtualKeyId = virtualKeyId;
    return true;
  }
}

export class InMemoryCustomerOrganizations implements CustomerOrganizationPort {
  organizations = new Map<
    string,
    { id: string; name: string; selfHostedCustomer: boolean }
  >();
  private sequence = 0;

  seed(name: string) {
    const id = `org_${++this.sequence}`;
    this.organizations.set(id, { id, name, selfHostedCustomer: false });
    return id;
  }

  async findById(id: string) {
    return this.organizations.get(id) ?? null;
  }

  async createSelfHostedCustomer({ name }: { name: string }) {
    const id = `org_${++this.sequence}`;
    const organization = { id, name, selfHostedCustomer: true };
    this.organizations.set(id, organization);
    return organization;
  }

  async markSelfHostedCustomer(id: string) {
    const organization = this.organizations.get(id);
    if (organization) organization.selfHostedCustomer = true;
  }
}

export class InMemoryConnectManagedKeys implements ConnectManagedKeyPort {
  keys = new Map<
    string,
    { organizationId: string; licenseId: string; retiredBy: string | null }
  >();
  invalidated: string[] = [];
  private sequence = 0;

  async provision({
    organizationId,
    licenseId,
  }: {
    organizationId: string;
    licenseId: string;
  }) {
    const id = `vk_${++this.sequence}`;
    this.keys.set(id, { organizationId, licenseId, retiredBy: null });
    return { id };
  }

  async retire({
    virtualKeyId,
    actorId,
  }: {
    virtualKeyId: string;
    organizationId: string;
    actorId: string;
  }) {
    const key = this.keys.get(virtualKeyId);
    if (key && key.retiredBy === null) key.retiredBy = actorId;
  }

  async invalidate({ virtualKeyId }: { virtualKeyId: string }) {
    this.invalidated.push(virtualKeyId);
  }

  active() {
    return [...this.keys.entries()]
      .filter(([, key]) => key.retiredBy === null)
      .map(([id]) => id);
  }
}
