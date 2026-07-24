export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { setEnvironment } = await import("@langwatch/ksuid");
    setEnvironment(process.env.ENVIRONMENT ?? "local");

    await import("./instrumentation.node");

    const { initializeWebApp } = await import("./server/app-layer/presets");
    try {
      initializeWebApp();
    } catch (error) {
      // Surface the real error clearly — Next.js wraps this in a generic
      // "An error occurred while loading instrumentation hook" message that hides the cause.
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      throw error;
    }
  }
}
