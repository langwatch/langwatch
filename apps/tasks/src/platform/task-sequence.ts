/**
 * Runs the named tasks one after another in the order they were given and
 * returns the first non-zero exit code.
 *
 * Stopping at the first failure is the whole point of the ordering: LangWatchQL
 * provisioning reads both schemas, so running it after a failed migration
 * provisions against a schema that is not there.
 */
export async function runTasksInOrder({
  names,
  args,
  runOne,
}: {
  names: readonly string[];
  args: readonly string[];
  runOne: (input: { name: string; args: readonly string[] }) => Promise<number>;
}): Promise<number> {
  for (const name of names) {
    const code = await runOne({ name, args });
    if (code !== 0) return code;
  }
  return 0;
}
