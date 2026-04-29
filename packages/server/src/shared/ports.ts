export const PORT_BASE_DEFAULT = 5560;
export const PORT_INFRA_OFFSET = 1000;
export const PORT_SLOT_INCREMENT = 10;
export const MAX_PORT_SLOT_ATTEMPTS = 30;

export type PortAllocation = {
  base: number;
  // App tier: base..base+9. Each LangWatch-shipped service gets a slot.
  // 5564..5567 reserved for future services so we never trample the infra
  // tier when we add the next data plane.
  langwatch: number;
  nlp: number;
  langevals: number;
  aigateway: number;
  // Infra tier: base+1000..base+1009. Embedded data stores live here so a
  // user with their own postgres/redis/clickhouse on canonical ports
  // doesn't collide. Auto-shift moves both tiers together by +10.
  postgres: number;
  redis: number;
  clickhouseHttp: number;
  clickhouseNative: number;
  bullboard: number;
};

// `npx @langwatch/server` ships the production Hono build, so the langwatch
// app is a single port (5560) with workers in-process — no separate vite or
// API split, no separate worker metrics port. See langwatch/scripts/start.sh:
// "In production, only the API server runs on PORT (default 5560)".
export function allocatePorts(base: number = PORT_BASE_DEFAULT): PortAllocation {
  const infra = base + PORT_INFRA_OFFSET;
  return {
    base,
    langwatch: base,
    nlp: base + 1,
    langevals: base + 2,
    aigateway: base + 3,
    postgres: infra,
    redis: infra + 1,
    clickhouseHttp: infra + 2,
    clickhouseNative: infra + 3,
    bullboard: infra + 4,
  };
}

export function portsToCheck(alloc: PortAllocation): Array<{ port: number; label: string }> {
  return [
    { port: alloc.langwatch, label: "langwatch" },
    { port: alloc.nlp, label: "nlpgo" },
    { port: alloc.langevals, label: "langevals" },
    { port: alloc.aigateway, label: "ai gateway" },
    { port: alloc.postgres, label: "postgres" },
    { port: alloc.redis, label: "redis" },
    { port: alloc.clickhouseHttp, label: "clickhouse http" },
    { port: alloc.clickhouseNative, label: "clickhouse native" },
    // bullboard is opt-in (--bullboard) — only verified bound when enabled.
  ];
}
