import type {
  CeremonyAccountPin,
  CeremonyAccountRow,
  IdentityAccountCeremonies,
} from "../rules/ceremony-types.rules.ts";
import type { IdentityUserGate } from "../rules/identity-user-gate.rules.ts";

/**
 * The account ceremonies as better-auth's `databaseHooks` bind them once the
 * identity storage adapter is live (ADR-116 §5).
 */
export class BetterAuthCeremonyBridgeService implements Pick<
  IdentityAccountCeremonies,
  "createAccountIdentifier" | "beforeAccountDelete"
> {
  static create(deps: {
    ceremonies: IdentityAccountCeremonies;
    routesToIdentity: IdentityUserGate;
  }): BetterAuthCeremonyBridgeService {
    return new BetterAuthCeremonyBridgeService(deps);
  }

  private constructor(
    private readonly deps: {
      ceremonies: IdentityAccountCeremonies;
      routesToIdentity: IdentityUserGate;
    },
  ) {}

  async createAccountIdentifier(account: CeremonyAccountRow): Promise<CeremonyAccountPin> {
    if (await this.deferred(account.userId)) return { pinned: false };

    return this.deps.ceremonies.createAccountIdentifier(account);
  }

  async beforeAccountDelete(
    account: Parameters<IdentityAccountCeremonies["beforeAccountDelete"]>[0],
  ): Promise<void> {
    if (await this.deferred(account.userId)) return;
    await this.deps.ceremonies.beforeAccountDelete(account);
  }

  private async deferred(userId: unknown): Promise<boolean> {
    return typeof userId === "string" && (await this.deps.routesToIdentity({ userId }));
  }
}
