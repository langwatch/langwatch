/**
 * The Postgres bundle. Hand-written rather than `prismaRepositories(...)`
 * because the provider store is read and written through the deployment's own
 * credential codec: the stored `customKeys` format is a wire format shared
 * between processes, so the cipher arrives with the connection.
 *
 * The codec is BUILT here from the `encryption` member rather than asked for
 * as a member of its own. `requires` may only name the fourteen keys of
 * `ProcessMembers` — `buildClaimedMembers` walks the process's member order
 * and refuses any claimed name it cannot find, and `createProcessMembers`
 * builds only `MEMBER_NAMES` — so a `"credentials"` entry could never be
 * satisfied by any process and stopped the api booting at all. This is the
 * same construction the composition deleted by b383462d96 performed
 * (`api-model-provider.composition.ts`: `EncryptedModelProviderCredentialAdapter.create({ cipher: options.encryption })`);
 * only its home moved, from a hand-written composition into the bundle that
 * needs it.
 *
 * The member is typed as this module's own `ModelProviderCredentialCipher`
 * rather than as `@langwatch/infrastructure`'s `Encryption`: the two are the
 * same shape (`encrypt`/`decrypt`, string in, string out), and a contract
 * package naming the platform's would be an undeclared dependency for the sake
 * of a type it can state itself.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ModelProviderCredentialCipher } from "../../app/model-provider.members.ts";
import type { ModelProviderRepositories } from "../model-provider.repositories.ts";
import { EncryptedModelProviderCredentialAdapter } from "../../services/encrypted.model-provider-api-key-credential.service.ts";
import { PrismaModelCostRepository } from "./prisma.model-cost.repository.ts";
import { PrismaModelDefaultRepository } from "./prisma.model-default.repository.ts";
import { PrismaModelProviderEvidenceRepository } from "./prisma.model-provider-evidence.repository.ts";
import { PrismaModelProviderRepository } from "./prisma.model-provider.repository.ts";

export class PostgresModelProviderRepositories {
  static readonly requires = ["prisma", "encryption"] as const;

  static create(
    members: Readonly<{
      prisma: PrismaClient;
      encryption: ModelProviderCredentialCipher;
    }>,
  ): ModelProviderRepositories {
    const credentials = EncryptedModelProviderCredentialAdapter.create({
      cipher: members.encryption,
    });
    return {
      providers: PrismaModelProviderRepository.create(
        members.prisma,
        credentials,
      ),
      defaults: PrismaModelDefaultRepository.create(members.prisma),
      costs: PrismaModelCostRepository.create(members.prisma),
      evidence: PrismaModelProviderEvidenceRepository.create(members.prisma),
    };
  }
}
