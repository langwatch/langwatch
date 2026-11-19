import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  PrivateModelEndpointBindingRecord,
  PrivateModelEndpointRecord,
  PrivateModelEndpointRepository,
} from "../private-model-endpoint.repository.ts";

type Database = Pick<
  PrismaClient,
  "privateModelEndpoint" | "privateModelEndpointBinding" | "$transaction"
>;

const ENDPOINT_COLUMNS = {
  id: true,
  organizationId: true,
  name: true,
  region: true,
  addresses: true,
  port: true,
  createdById: true,
} as const;

const BINDING_COLUMNS = {
  id: true,
  organizationId: true,
  endpointId: true,
  hostname: true,
  createdById: true,
} as const;

/** Postgres rows for private endpoints and their bindings; every query names the organization. */
export class PrismaPrivateModelEndpointRepository implements PrivateModelEndpointRepository {
  private constructor(private readonly database: Database) {}

  static create(database: Database): PrismaPrivateModelEndpointRepository {
    return new PrismaPrivateModelEndpointRepository(database);
  }

  findEndpoints({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PrivateModelEndpointRecord[]> {
    return this.database.privateModelEndpoint.findMany({
      where: { organizationId },
      select: ENDPOINT_COLUMNS,
      orderBy: { createdAt: "asc" },
    });
  }

  findEndpoint({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }): Promise<PrivateModelEndpointRecord | null> {
    return this.database.privateModelEndpoint.findFirst({
      where: { organizationId, id },
      select: ENDPOINT_COLUMNS,
    });
  }

  saveEndpoint(input: PrivateModelEndpointRecord): Promise<PrivateModelEndpointRecord> {
    const { id, organizationId, createdById, ...fields } = input;
    return this.database.privateModelEndpoint.upsert({
      where: { id },
      create: { id, organizationId, createdById, ...fields },
      update: fields,
      select: ENDPOINT_COLUMNS,
    });
  }

  async removeEndpoint({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }): Promise<void> {
    await this.database.$transaction([
      this.database.privateModelEndpointBinding.deleteMany({
        where: { organizationId, endpointId: id },
      }),
      this.database.privateModelEndpoint.deleteMany({ where: { organizationId, id } }),
    ]);
  }

  findBindings({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PrivateModelEndpointBindingRecord[]> {
    return this.database.privateModelEndpointBinding.findMany({
      where: { organizationId },
      select: BINDING_COLUMNS,
      orderBy: { hostname: "asc" },
    });
  }

  findBinding({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }): Promise<PrivateModelEndpointBindingRecord | null> {
    return this.database.privateModelEndpointBinding.findFirst({
      where: { organizationId, id },
      select: BINDING_COLUMNS,
    });
  }

  findBindingByHostname({
    organizationId,
    hostname,
  }: {
    organizationId: string;
    hostname: string;
  }): Promise<PrivateModelEndpointBindingRecord | null> {
    return this.database.privateModelEndpointBinding.findFirst({
      where: { organizationId, hostname },
      select: BINDING_COLUMNS,
    });
  }

  saveBinding(
    input: PrivateModelEndpointBindingRecord,
  ): Promise<PrivateModelEndpointBindingRecord> {
    const { id, organizationId, createdById, ...fields } = input;
    return this.database.privateModelEndpointBinding.upsert({
      where: { id },
      create: { id, organizationId, createdById, ...fields },
      update: fields,
      select: BINDING_COLUMNS,
    });
  }

  async removeBinding({
    organizationId,
    id,
  }: {
    organizationId: string;
    id: string;
  }): Promise<void> {
    await this.database.privateModelEndpointBinding.deleteMany({ where: { organizationId, id } });
  }
}
