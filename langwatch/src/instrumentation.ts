export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { setEnvironment } = await import("@langwatch/ksuid");
    setEnvironment(process.env.ENVIRONMENT ?? "local");

    await import("./instrumentation.node");

    const { initializeWebApp } = await import("./server/app-layer/presets");
    initializeWebApp();
  }
}
