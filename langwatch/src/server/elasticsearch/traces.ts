import * as T from '@elastic/elasticsearch/lib/api/types'
import { Client as ElasticClient } from "@elastic/elasticsearch";
import {
  type ElasticSearchTrace,
  type Trace,
} from "../tracer/types";
import { TRACE_INDEX, esClient } from "../elasticsearch";
import type { Protections } from "./protections";
import { transformElasticSearchTraceToTrace } from "./transformers";
interface ProjectConnectionConfig {
  projectId: string;
}
interface OrganizationConnectionConfig {
  organizationId: string;
}
interface TestConnectionConfig {
  test: true;
}

type ConnectionConfig = ProjectConnectionConfig | OrganizationConnectionConfig | TestConnectionConfig;

interface SearchTracesOptions {
  connConfig: ConnectionConfig;
  search: Parameters<ElasticClient['search']>[0] & {
    index?: typeof TRACE_INDEX[keyof typeof TRACE_INDEX];
    size?: number;
  };
  protections: Protections;
}

export async function searchTraces({
  connConfig,
  search: {
    index = TRACE_INDEX.alias,
    size = 10,
    ...searchParams
  },
  protections = {},
}: SearchTracesOptions): Promise<Trace[]> {
  const client = await esClient(connConfig);
  const result = await client.search<ElasticSearchTrace>({
    index,
    size,
    ...searchParams
  });

  const traces = result.hits.hits
    .map((hit) => hit._source!)
    .filter((x) => x)
    .map((t) => transformElasticSearchTraceToTrace(t, protections));

  return traces;
}
