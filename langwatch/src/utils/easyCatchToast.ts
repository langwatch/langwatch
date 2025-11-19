import { toaster } from "../components/ui/toaster";

/**
 * Single Responsibility: Log asynchronous errors surfaced through shared catch helpers
 * without interrupting control flow. Allows for named errors to be logged with a prefix.
 * Also shows a toast notification for user feedback.
 *
 * @param error - The error captured by a promise rejection handler.
 * @param name - The name of the function that caught the error.
 */
export function easyCatchToast(error: unknown, name?: string): void {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (name) {
    console.error(`[${name}]`, error);
    toaster.create({
      title: "Error",
      description: `Error in ${name}: ${errorMessage}`,
      type: "error",
      duration: 5000,
      meta: { closable: true },
    });
  } else {
    console.error(error);
    toaster.create({
      title: "Error",
      description: `An error occurred: ${errorMessage}`,
      type: "error",
      duration: 5000,
      meta: { closable: true },
    });
  }
}
