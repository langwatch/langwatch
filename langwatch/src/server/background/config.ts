export const DEFAULT_WORKER_METRICS_PORT = 2999;

export const getWorkerMetricsPort = (): number => {
  const portString =
    process.env.WORKER_METRICS_PORT ?? String(DEFAULT_WORKER_METRICS_PORT);
  const port = parseInt(portString, 10);

  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid WORKER_METRICS_PORT: "${portString}". Must be a number between 1 and 65535.`
    );
  }

  return port;
};
