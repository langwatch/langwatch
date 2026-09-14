export abstract class AutomationEmailCapRepository {
  abstract claim(
    key: string,
    value: string,
    expiry: "EX",
    seconds: number,
    condition: "NX",
  ): Promise<"claimed" | "already-claimed">;
  abstract findValue(key: string): Promise<string | null>;
  abstract incr(key: string): Promise<number>;
  abstract incrby(key: string, increment: number): Promise<number>;
  abstract eval(script: string, keyCount: number, key: string, seconds: string): Promise<unknown>;
}
