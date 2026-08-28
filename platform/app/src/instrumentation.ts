export async function register() {
  const { isNodeInstrumentationRuntime } = await import("@langwatch/config");
  if (isNodeInstrumentationRuntime(process.env)) {
    const { initializeEnvironmentConfig } = await import("./env.mjs");
    initializeEnvironmentConfig(process.env);

    const { resolveProcessBootstrapConfig } = await import("./runtime/executable-bootstrap.config");
    const bootstrap = resolveProcessBootstrapConfig(process.env);
    const { configureLogger } = await import("@langwatch/observability");
    configureLogger(bootstrap.logger);

    const { setEnvironment } = await import("@langwatch/ksuid");
    setEnvironment(bootstrap.environment);

    const { initializeInstrumentation } = await import("./instrumentation.node");
    initializeInstrumentation(bootstrap.telemetry);

    const { initializeWebApp } = await import("./server/app-layer/presets");
    try {
      initializeWebApp();
    } catch (error) {
      // Surface the real error clearly — Next.js wraps this in a generic
      // "An error occurred while loading instrumentation hook" message that hides the cause.
      console.error(error instanceof Error ? (error.stack ?? error.message) : error);
      throw error;
    }
  }
}
