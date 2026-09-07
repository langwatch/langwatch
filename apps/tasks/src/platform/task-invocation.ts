import { ValidationError } from "@langwatch/handled-error";

/**
 * What one `pnpm -s task ...` invocation asks for: the task names, in the
 * order they were written, and the arguments handed to the single task that
 * takes them.
 */
export type TaskInvocation = Readonly<{
  names: readonly string[];
  args: readonly string[];
}>;

/**
 * Reads the argument list after the program name.
 *
 * Leading words that name a task are the tasks to run, in order; the rest are
 * that task's own arguments. Arguments only make sense for one task — a flag
 * written after three names belongs to none of them in particular — so the
 * combination is refused rather than guessed at. A first word that names no
 * task is passed through untouched, so the catalogue is the one that reports
 * it, with the names it does answer to.
 */
export function parseTaskInvocation({
  argv,
  isTaskName,
}: {
  argv: readonly string[];
  isTaskName: (name: string) => boolean;
}): TaskInvocation {
  const names: string[] = [];
  let index = 0;
  while (index < argv.length && isTaskName(argv[index]!)) {
    names.push(argv[index]!);
    index += 1;
  }
  const args = argv.slice(index);

  if (names.length === 0) return { names: argv.slice(0, 1), args: argv.slice(1) };
  if (names.length > 1 && args.length > 0) {
    throw new ValidationError(
      `Arguments cannot be given alongside several task names: ${args.join(" ")}`,
    );
  }
  return { names, args };
}
