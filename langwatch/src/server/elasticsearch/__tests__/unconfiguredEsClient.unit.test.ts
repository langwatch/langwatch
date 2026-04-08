import { describe, expect, it } from "vitest";

/**
 * The unconfiguredEsClient Proxy is not exported directly, but we can
 * exercise it via esClient() when ELASTICSEARCH_NODE_URL is unset.
 * Since esClient is async and reads env/prisma, we test the Proxy
 * behavior by replicating its construction here.
 */
describe("unconfiguredEsClient Proxy", () => {
  // Replicate the Proxy from elasticsearch.ts so we can test it in isolation
  const unconfiguredEsClient = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === "then" || typeof prop === "symbol") return undefined;
      return () => {
        throw new Error(
          `Elasticsearch is not configured (called .${String(prop)}()). ` +
            `Set ELASTICSEARCH_NODE_URL or remove this code path.`,
        );
      };
    },
  });

  it("throws with descriptive message when any method is called", () => {
    expect(() => (unconfiguredEsClient as any).search()).toThrow(
      "Elasticsearch is not configured (called .search())",
    );
    expect(() => (unconfiguredEsClient as any).index()).toThrow(
      "called .index()",
    );
    expect(() => (unconfiguredEsClient as any).bulk()).toThrow(
      "called .bulk()",
    );
  });

  it("returns undefined for 'then' to avoid being treated as a thenable", () => {
    expect((unconfiguredEsClient as any).then).toBeUndefined();
  });

  it("returns undefined for symbol properties", () => {
    expect((unconfiguredEsClient as any)[Symbol.toPrimitive]).toBeUndefined();
    expect((unconfiguredEsClient as any)[Symbol.iterator]).toBeUndefined();
  });
});
