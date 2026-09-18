import type { SecretHandle } from "./secret.ts";
/**
 * Refuses one credential declared by two owners (§6). A credential has one
 * owner: it declares the handle, builds the collaborator, and the process
 * injects THAT into whoever else needs it (ADR-132).
 */
import { SecretClaimedTwiceError } from "./secrets.errors.ts";

/** An owner as the boot seam reads one: a name, and the handles it declared. */
export type SecretsOwner = Readonly<{
  name: string;
  secrets?: Readonly<Record<string, SecretHandle<unknown>>>;
}>;

export function refuseDoubleClaims(owners: readonly SecretsOwner[]): void {
  const claimed = new Map<string, { handle: SecretHandle<unknown>; owner: string }>();

  for (const owner of owners) {
    for (const handle of Object.values(owner.secrets ?? {})) {
      const held = claimed.get(handle.id);

      if (held) {
        throw new SecretClaimedTwiceError(handle.id, [held.owner, owner.name]);
      }

      claimed.set(handle.id, { handle, owner: owner.name });
    }
  }
}
