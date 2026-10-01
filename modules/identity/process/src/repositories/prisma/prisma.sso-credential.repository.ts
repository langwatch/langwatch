import type { SsoCredentialKind } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { Encryption } from "@langwatch/process-stores/members";

import { newSsoCredentialId } from "../../rules/sso-connection-id.rules.ts";
import { type SsoCredentialRead, SsoCredentialRepository } from "../sso-credential.repository.ts";

const logger = createLogger("langwatch:identity:sso-credentials");

/** The one delegate this repository reads and writes. */
export type PrismaSsoCredentialDatabase = {
  ssoCredential: {
    create(args: {
      data: {
        id: string;
        organizationId: string;
        connectionId: string;
        kind: string;
        ciphertext: string;
      };
    }): Promise<unknown>;
    findFirst(args: {
      where: { id: string; organizationId: string };
    }): Promise<{ ciphertext: string } | null>;
  };
};

/**
 * The vault a connection's credential references point at (D09), sealed
 * through the process's own cipher rather than a scheme of this module's:
 * a second one is a second thing to rotate, against the same threat.
 */
export class PrismaSsoCredentialRepository extends SsoCredentialRepository {
  static create(
    database: PrismaSsoCredentialDatabase,
    encryption: Encryption,
  ): PrismaSsoCredentialRepository {
    return new PrismaSsoCredentialRepository(database, encryption);
  }

  private constructor(
    private readonly database: PrismaSsoCredentialDatabase,
    private readonly encryption: Encryption,
  ) {
    super();
  }

  async put({
    organizationId,
    connectionId,
    kind,
    value,
  }: {
    organizationId: string;
    connectionId: string;
    kind: SsoCredentialKind;
    value: string;
  }): Promise<string> {
    const id = newSsoCredentialId();
    await this.database.ssoCredential.create({
      data: {
        id,
        organizationId,
        connectionId,
        kind,
        ciphertext: this.encryption.encrypt(value),
      },
    });

    return id;
  }

  async read({
    organizationId,
    ref,
  }: {
    organizationId: string;
    ref: string;
  }): Promise<SsoCredentialRead> {
    const row = await this.database.ssoCredential.findFirst({
      where: { id: ref, organizationId },
    });
    if (!row) return { found: false };

    try {
      return { found: true, value: this.encryption.decrypt(row.ciphertext) };
    } catch (error) {
      // A row written under a secret that has since been rotated. Answered
      // as absent: the caller builds the engine's provider row, and an
      // unreadable credential is a row that should not exist.
      logger.error(
        { organizationId, ref, error },
        "an sso credential could not be read; the connection will not be dialable",
      );

      return { found: false };
    }
  }
}
