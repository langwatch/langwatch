/** Better Auth's optional shared session cache and active-session index. */
export abstract class AuthSecondaryStorePort {
  abstract get(input: { key: string }): Promise<string | null>;
  abstract set(input: { key: string; value: string }): Promise<void>;
  abstract delete(input: { key: string }): Promise<void>;
}
