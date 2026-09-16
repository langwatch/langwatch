/**
 * Runs the named tasks in order and returns the first non-zero exit code.
 * Stopping at the first failure is the point of the ordering: LangWatchQL
 * provisioning reads both schemas, so it must not run after a failed migration.
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
