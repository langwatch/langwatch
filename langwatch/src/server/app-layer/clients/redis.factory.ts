import IORedis, { Cluster } from "ioredis";

export interface RedisFactoryOptions {
  url?: string;
  clusterEndpoints?: string;
}

function parseClusterEndpoints(endpointsStr: string) {
  return endpointsStr.split(",").map((raw) => {
    const url = raw.includes("://") ? new URL(raw) : new URL(`redis://${raw}`);
    return { host: url.hostname, port: Number(url.port || 6379) };
  });
}

export function createRedisConnectionFromConfig(
  opts: RedisFactoryOptions,
): IORedis | Cluster | null {
  if (!opts.url && !opts.clusterEndpoints) return null;

  if (opts.clusterEndpoints) {
    const endpoints = parseClusterEndpoints(opts.clusterEndpoints);
    return new Cluster(endpoints, {
      redisOptions: {
        maxRetriesPerRequest: null,
        offlineQueue: false,
      },
      dnsLookup: (address, callback) => callback(null, address),
      scaleReads: "all",
    });
  }

  return new IORedis(opts.url!, {
    maxRetriesPerRequest: null,
    offlineQueue: false,
    tls: opts.url?.includes("tls.rejectUnauthorized=false")
      ? { rejectUnauthorized: false }
      : opts.url?.includes("rediss://")
        ? {}
        : void 0,
  });
}
