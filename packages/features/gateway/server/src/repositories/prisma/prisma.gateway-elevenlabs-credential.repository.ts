import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  GatewayElevenLabsCredentialRepository,
  type GatewayElevenLabsProviderRow,
} from "../gateway-elevenlabs-credential.repository";

/** The client slice the ElevenLabs credential reads bind to. */
export type GatewayElevenLabsCredentialDatabase = Pick<PrismaClient, "modelProvider">;

/** Private Prisma owner for the provider row an ElevenLabs credential lives on. */
export class PrismaGatewayElevenLabsCredentialRepository extends GatewayElevenLabsCredentialRepository {
  static create(input: {
    database: GatewayElevenLabsCredentialDatabase;
  }): PrismaGatewayElevenLabsCredentialRepository {
    return new PrismaGatewayElevenLabsCredentialRepository(input.database);
  }

  private constructor(private readonly database: GatewayElevenLabsCredentialDatabase) {
    super();
  }

  findProviderRow({
    modelProviderId,
  }: {
    modelProviderId: string;
  }): Promise<GatewayElevenLabsProviderRow | null> {
    return this.database.modelProvider.findUnique({
      where: { id: modelProviderId },
      select: { provider: true, organizationId: true, customKeys: true },
    });
  }
}
