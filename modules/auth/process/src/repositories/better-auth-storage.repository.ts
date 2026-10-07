/**
 * Better Auth's storage engine, one per tier. Typed as the library option (an
 * adapter factory, not a client) so the instance never learns which store it has.
 */
export abstract class BetterAuthStorageRepository {
  /** The value handed to `betterAuth({ database })`. */
  abstract adapter(): unknown;
}
