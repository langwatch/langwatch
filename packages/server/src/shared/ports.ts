export const PORT_BASE_DEFAULT = 5560;
export const PORT_SLOT_INCREMENT = 10;
export const MAX_PORT_SLOT_ATTEMPTS = 30;

export type PortAllocation = {
  base: number;
  langwatch: number;
  nlp: number;
  langevals: number;
  aigateway: number;
  redis: number;
  clickhouseHttp: number;
  clickhouseNative: number;
  postgres: number;
};

// `npx @langwatch/server` ships the production Hono build, so the langwatch
// app is a single port (5560) with workers in-process — no separate vite or
// API split, no separate worker metrics port. See langwatch/scripts/start.sh:
// "In production, only the API server runs on PORT (default 5560)".
export function allocatePorts(base: number = PORT_BASE_DEFAULT): PortAllocation {
  return {
    base,
    langwatch: base,
    nlp: base + 1,
    langevals: base + 2,
    aigateway: base + 3,
    redis: base + 4,
    clickhouseHttp: base + 5,
    clickhouseNative: base + 6,
    postgres: base + 7,
  };
}

export function portsToCheck(alloc: PortAllocation): Array<{ port: number; label: string }> {
  return [
    { port: alloc.langwatch, label: "langwatch" },
    { port: alloc.nlp, label: "langwatch_nlp" },
    { port: alloc.langevals, label: "langevals" },
    { port: alloc.aigateway, label: "ai gateway" },
    { port: alloc.redis, label: "redis" },
    { port: alloc.clickhouseHttp, label: "clickhouse http" },
    { port: alloc.clickhouseNative, label: "clickhouse native" },
    { port: alloc.postgres, label: "postgres" },
  ];
}
