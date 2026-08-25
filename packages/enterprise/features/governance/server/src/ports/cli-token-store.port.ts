export abstract class CliTokenStorePort {
  abstract members(key: string): Promise<string[]>;
  abstract tryGet(key: string): Promise<string | null>;
  abstract delete(key: string): Promise<number>;
  abstract removeMembers(key: string, members: string[]): Promise<number>;
}
