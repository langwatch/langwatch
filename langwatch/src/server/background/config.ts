// Worker metrics port follows PORT so non-default PORT slots (5570, 5580…)
// don't all collide on 2999. PORT=5560 → 2999 (back-compat).
const WORKER_METRICS_PORT_OFFSET = 2561;

export const DEFAULT_WORKER_METRICS_PORT = 2999;

const getDefaultWorkerMetricsPort = (): number => {
  const portString = process.env.PORT;
  if (portString === undefined || portString === "") {
    return DEFAULT_WORKER_METRICS_PORT;
  }
  const basePort = parseInt(portString, 10);
  if (Number.isNaN(basePort)) {
    return DEFAULT_WORKER_METRICS_PORT;
  }
  return basePort - WORKER_METRICS_PORT_OFFSET;
};

export const getWorkerMetricsPort = (): number => {
  const portString =
    process.env.WORKER_METRICS_PORT ?? String(getDefaultWorkerMetricsPort());
  const port = parseInt(portString, 10);

  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid WORKER_METRICS_PORT: "${portString}". Must be a number between 1 and 65535.`
    );
  }

  return port;
};
