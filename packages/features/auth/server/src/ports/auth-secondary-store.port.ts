/** Better Auth's optional shared session cache and active-session index. */
export abstract class AuthSecondaryStorePort {
  /** `try` because a cache miss is the ordinary answer, not a failure. */
  abstract tryGet(input: { key: string }): Promise<string | null>;
  abstract set(input: { key: string; value: string }): Promise<void>;
  abstract delete(input: { key: string }): Promise<void>;
}
