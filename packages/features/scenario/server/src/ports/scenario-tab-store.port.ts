export abstract class ScenarioTabStorePort {
  abstract refresh(input: {
    key: string;
    member: string;
    score: number;
    ttlSeconds: number;
  }): Promise<void>;

  abstract retire(input: { key: string; member: string; score: number }): Promise<void>;

  abstract countAfter(input: { key: string; cutoff: number }): Promise<number>;

  abstract setPending(input: { key: string; url: string; ttlSeconds: number }): Promise<void>;

  abstract tryTakePending(key: string): Promise<string | null>;
}
