/**
 * Single Responsibility: Log asynchronous errors surfaced through shared catch helpers
 * without interrupting control flow. Allows for named errors to be logged with a prefix.
 *
 * @param error - The error captured by a promise rejection handler.
 * @param name - The name of the function that caught the error.
 */
export function easyCatch(error: unknown, name?: string): void {
  if (name) {
    console.error(`[${name}]}`, error);
  } else {
    console.error(error);
  }
}
