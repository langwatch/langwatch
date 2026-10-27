import type {
  SignInProviderMount,
  SignInProviderMountRepository,
} from "../sign-in-provider-mount.repository.ts";

/** The one row, held in memory. */
export class MemorySignInProviderMountRepository implements SignInProviderMountRepository {
  #row: SignInProviderMount | undefined;

  static create(): MemorySignInProviderMountRepository {
    return new MemorySignInProviderMountRepository();
  }

  private constructor() {}

  async find(): Promise<readonly SignInProviderMount[]> {
    return this.#row ? [this.#row] : [];
  }

  async save(mount: SignInProviderMount): Promise<void> {
    this.#row = { ...mount };
  }
}
