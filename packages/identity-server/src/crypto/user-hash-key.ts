import { randomBytes } from "node:crypto";

/** Fresh key material for `User.userHashKey` (ADR-101 §4): 32 random bytes,
 *  hex. Storing it is the IdentityUsersRepository's guarded write. */
export function mintUserHashKey(): string {
  return randomBytes(32).toString("hex");
}
