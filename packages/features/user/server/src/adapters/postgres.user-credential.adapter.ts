import type { UserPasswordHasherPort } from "../ports/user.port";
import {
  PrismaUserCredentialRepository,
  type UserCredentialDatabase,
} from "../repositories/prisma/prisma.user-credential.repository";
import { UserCredentialService } from "../services/user-credential.service";

export type { UserCredentialDatabase };

export interface PostgresUserCredentialAdapterOptions {
  /** The one guarded connection the five account statements run on. */
  database: UserCredentialDatabase;
  /** The deployment's stored-password format, stated once by the process. */
  passwords: UserPasswordHasherPort;
}

/**
 * The typed seam between a process's Prisma connection and the credential
 * service.
 *
 * A second adapter beside {@link PostgresUserAdapter} rather than another
 * option on it, because the two are composed by different callers for
 * different reasons: the user service is built wherever a profile is read, and
 * this one only where somebody can change their own password. Folding them
 * would hand every process that reads a name a reader that returns a hash.
 */
export class PostgresUserCredentialAdapter {
  private constructor(private readonly options: PostgresUserCredentialAdapterOptions) {}

  static create(options: PostgresUserCredentialAdapterOptions): PostgresUserCredentialAdapter {
    return new PostgresUserCredentialAdapter(options);
  }

  build(): UserCredentialService {
    return UserCredentialService.create({
      repository: PrismaUserCredentialRepository.create(this.options.database),
      passwords: this.options.passwords,
    });
  }
}
