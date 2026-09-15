import { SecretSource } from "./secret-source.port.ts";

/** Which source answered for one key. The value is deliberately not carried. */
export type SecretAttribution = Readonly<{ key: string; source: string }>;

/**
 * Ordered sources, first answer wins.
 *
 * Each source is asked only for the keys still outstanding, so a chain whose
 * first rung answers everything never starts the subprocess behind its second.
 * The attribution it records is what the boot line prints: key name and source
 * name, so a stale shell export shadowing the vault is visible rather than
 * mysterious.
 */
export class ChainedSecretSource extends SecretSource {
  static create({
    sources,
    name = "chain",
  }: {
    sources: readonly SecretSource[];
    name?: string;
  }): ChainedSecretSource {
    return new ChainedSecretSource(sources, name);
  }

  private readonly attributions: SecretAttribution[] = [];

  private constructor(
    private readonly sources: readonly SecretSource[],
    readonly name: string,
  ) {
    super();
  }

  /** Who answered for each key resolved so far, in the order they were answered. */
  attribution(): readonly SecretAttribution[] {
    return [...this.attributions];
  }

  async resolve({ keys }: { keys: readonly string[] }): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    let outstanding = [...keys];

    for (const source of this.sources) {
      if (outstanding.length === 0) break;
      const answered = await source.resolve({ keys: outstanding });
      for (const [key, value] of answered) {
        if (found.has(key)) continue;
        found.set(key, value);
        this.attributions.push({ key, source: source.name });
      }
      outstanding = outstanding.filter((key) => !found.has(key));
    }

    return found;
  }
}
