export abstract class OpsSnapshotRedisPort {
  abstract eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
  abstract set(
    key: string,
    value: string,
    expiryMode: "EX",
    expirySeconds: number,
    condition: "NX",
  ): Promise<unknown>;
  abstract get(key: string): Promise<string | null>;
  abstract incr(key: string): Promise<number>;
}
