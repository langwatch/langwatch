export const PORT_BASE_DEFAULT = 5560;
export const PORT_INFRA_OFFSET = 1000;
export const PORT_SLOT_INCREMENT = 10;
export const MAX_PORT_SLOT_ATTEMPTS = 30;

export type PortAllocation = {
  base: number;
  // App tier: base..base+9. Each LangWatch-shipped service gets a slot;
  // 5566..5569 stay free for the next one, clear of the infra tier.
  langwatch: number;
  nlp: number;
  langevals: number;
  aigateway: number;
  langyagent: number;
  // The backend's worker half answers its own health door (WORKER_METRICS_PORT).
  workerHealth: number;
  // Infra tier: base+1000..base+1009. Embedded data stores live here so a
  // user with their own postgres/redis/clickhouse on canonical ports
  // doesn't collide. Auto-shift moves both tiers together by +10.
  postgres: number;
  redis: number;
  clickhouseHttp: number;
  clickhouseNative: number;
};

// `npx @langwatch/server` runs apps/backend: the api and the worker in one Node
// process. The api serves the browser bundle on `langwatch`; the worker half
// still opens its own health door, so it gets a slot instead of the default 2999.
export function allocatePorts(base: number = PORT_BASE_DEFAULT): PortAllocation {
  const infra = base + PORT_INFRA_OFFSET;
  return {
    base,
    langwatch: base,
    nlp: base + 1,
    langevals: base + 2,
    aigateway: base + 3,
    langyagent: base + 4,
    workerHealth: base + 5,
    postgres: infra,
    redis: infra + 1,
    clickhouseHttp: infra + 2,
    clickhouseNative: infra + 3,
  };
}

export function portsToCheck(alloc: PortAllocation): { port: number; label: string }[] {
  return [
    { port: alloc.langwatch, label: "langwatch" },
    { port: alloc.nlp, label: "nlpgo" },
    { port: alloc.langevals, label: "langevals" },
    { port: alloc.aigateway, label: "ai gateway" },
    { port: alloc.langyagent, label: "langy agent" },
    { port: alloc.workerHealth, label: "langwatch worker health" },
    { port: alloc.postgres, label: "postgres" },
    { port: alloc.redis, label: "redis" },
    { port: alloc.clickhouseHttp, label: "clickhouse http" },
    { port: alloc.clickhouseNative, label: "clickhouse native" },
  ];
}
