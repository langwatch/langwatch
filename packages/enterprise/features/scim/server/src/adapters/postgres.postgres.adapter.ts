import type { ScimTokenDatabase } from "../ports/scim-token-database.port";
import { PrismaScimTokenRepository } from "../repositories/prisma/prisma.scim-token.repository";
import {
  type ScimEntitlementProvider,
  ScimTokenService,
} from "../services/scim-token.service";

export interface PostgresScimTokenAdapterOptions {
  database: ScimTokenDatabase;
  entitlements: ScimEntitlementProvider;
  now?: (() => Date) | undefined;
  generateToken?: (() => string) | undefined;
}

export class PostgresScimTokenAdapter {
  private constructor(private readonly options: PostgresScimTokenAdapterOptions) {}

  static create(options: PostgresScimTokenAdapterOptions): PostgresScimTokenAdapter {
    return new PostgresScimTokenAdapter(options);
  }

  build(): ScimTokenService {
    return ScimTokenService.create({
      repository: PrismaScimTokenRepository.create(this.options.database),
      entitlements: this.options.entitlements,
      now: this.options.now,
      generateToken: this.options.generateToken,
    });
  }
}
