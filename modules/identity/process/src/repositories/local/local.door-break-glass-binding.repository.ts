import type { SsoBreakGlassBindingRepository } from "../sso-connection.repository.ts";

/**
 * Activation's first break-glass precondition: the deployment hangs a
 * password door for a grant to be a way in through. It asks the resolved
 * method policy, never a list that is always full.
 */
export class LocalDoorBreakGlassBindingRepository implements SsoBreakGlassBindingRepository {
  static create(options: {
    passwordDoor: () => Promise<boolean>;
  }): LocalDoorBreakGlassBindingRepository {
    return new LocalDoorBreakGlassBindingRepository(options.passwordDoor);
  }

  private constructor(private readonly passwordDoor: () => Promise<boolean>) {}

  async hasLiveBinding(_args: { organizationId: string }): Promise<boolean> {
    return this.passwordDoor();
  }

  /** The local door has nothing to reserve: it is open or it is not. */
  async reserveActivationRecovery(args: { organizationId: string }): Promise<boolean> {
    return this.hasLiveBinding(args);
  }
}
