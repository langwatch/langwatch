import type { UserAvatarMediaType } from "@langwatch/user-contract";

export abstract class UserAvatarStoragePort {
  abstract store(input: {
    projectId: string;
    userId: string;
    mediaType: UserAvatarMediaType;
    bytes: Uint8Array;
  }): Promise<{ id: string }>;
}

/**
 * The deployment's stored-password format, as the one operation that compares
 * a hash and the one that writes a new one.
 *
 * A port rather than a direct bcrypt call, because the cost factor is part of
 * the STORED format rather than a choice this package gets to make: every
 * credential row in the database was written at the process's cost, and a
 * package that picked its own would write rows nobody can account for. The
 * process states it once and both halves of a rotation run through it.
 *
 * It is also what keeps the hash inside {@link UserCredentialService}. The
 * service reads a hash, hands it here, and gets back a boolean — no caller
 * above it ever holds one.
 */
export abstract class UserPasswordHasherPort {
  abstract hash(input: { password: string }): Promise<string>;
  abstract matches(input: { password: string; hash: string }): Promise<boolean>;
}
