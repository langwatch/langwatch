/**
 * `VITEST_MAX_WORKERS` is a ceiling, and vitest applies it as an assignment.
 *
 * Vitest resolves `fileParallelism: false` by forcing `maxWorkers` to 1
 * ("parallelism cannot be implemented without limiting workers"), and only
 * afterwards reads `VITEST_MAX_WORKERS` and assigns it over whatever it just
 * resolved. A variable set to keep vitest off all of a runner's cores
 * therefore hands it a second worker on a suite that asked for none, and the
 * suite runs two files at once while every comment around it says it does not.
 *
 * Strip the variable while files are serial, where it can only raise the
 * number it exists to lower. When file parallelism is on it is a real cap and
 * is passed through untouched.
 */
export function applyWorkerCap({
  env,
  fileParallelism,
}: {
  env: NodeJS.ProcessEnv;
  fileParallelism: boolean;
}): void {
  if (fileParallelism) return;
  delete env.VITEST_MAX_WORKERS;
}
