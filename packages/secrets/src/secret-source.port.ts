// One place a secret value can come from. resolve() is batched so sources
// backed by subprocess/HTTP pay once per boot. Absence is a missing map entry;
// throw means source failed, not "secret does not exist".
export abstract class SecretSource {
  abstract readonly name: string;

  abstract resolve({ keys }: { keys: readonly string[] }): Promise<Map<string, string>>;
}
