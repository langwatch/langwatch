import { compare, hash } from "bcrypt";

/** The stored-password format: the one way a hash is written and the one way it is compared. */
export interface UserPasswordHasher {
  hash(input: { password: string }): Promise<string>;
  matches(input: { password: string; hash: string }): Promise<boolean>;
}

/** The bcrypt cost every stored credential in this database was written at. */
const PASSWORD_HASH_COST = 10;

/**
 * The stored password format, stated once: bcrypt at cost 10, which is what every credential
 * row in the database already carries. Both halves of a rotation run through it.
 */
export class UserPasswordService implements UserPasswordHasher {
  static create(): UserPasswordService {
    return new UserPasswordService();
  }

  private constructor() {}

  hash({ password }: { password: string }): Promise<string> {
    return hash(password, PASSWORD_HASH_COST);
  }

  matches({ password, hash: stored }: { password: string; hash: string }): Promise<boolean> {
    return compare(password, stored);
  }
}
