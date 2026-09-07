import type {
  SsoCredentialKind,
  SsoCredentialStore,
} from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { nanoid } from "nanoid";
import type { PrismaClient } from "~/generated/prisma/client";
import { decrypt, encrypt } from "~/utils/encryption";

const logger = createLogger("langwatch.identity.sso-credentials");

/**
 * The vault an SSO connection's credential references point at (D09 — see
 * specs/identity/sso-idp-termination.feature).
 *
 * Encryption is `~/utils/encryption`, which is what every other credential in
 * the product is kept under: AES-256-GCM keyed by the deployment's
 * `CREDENTIALS_SECRET`. Not a scheme of its own, deliberately — a second one
 * would be a second thing to rotate and a second thing to get wrong, and the
 * threat this defends against (a database copy without the application's
 * secret) is the same threat.
 *
 * Reads are scoped by organization as well as by reference. A reference is an
 * opaque id, and an id being hard to guess is not an access rule.
 */
export class PrismaSsoCredentialStore implements SsoCredentialStore {
  constructor(private readonly prisma: PrismaClient) {}

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
    // A fresh id per write, never an update in place. Rotating a credential
    // mints a NEW reference carried by a NEW fact, which is what makes "when
    // did this change" answerable from the log while the log holds no value.
    const id = `ssocred_${nanoid()}`;
    await this.prisma.ssoCredential.create({
      data: {
        id,
        organizationId,
        connectionId,
        kind,
        ciphertext: encrypt(value),
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
  }): Promise<string | null> {
    const row = await this.prisma.ssoCredential.findFirst({
      where: { id: ref, organizationId },
    });
    if (row === null) return null;
    try {
      return decrypt(row.ciphertext);
    } catch (error) {
      // A row written under a secret that has since been rotated. Answered as
      // absent rather than thrown, because the caller is the fold that builds
      // the engine's provider row: an unreadable credential means the
      // connection cannot be dialed, which is a row that should not exist —
      // not a projection that should stop.
      logger.error(
        { organizationId, ref, error },
        "an sso credential could not be read; the connection will not be dialable",
      );
      return null;
    }
  }
}
