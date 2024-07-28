import { Client } from "@elastic/elasticsearch";
import { env } from "../env.mjs";

export const TRACE_INDEX = "search-traces";

export const DSPY_STEPS_INDEX = "search-dspy-steps";

export const OPENAI_EMBEDDING_DIMENSION = 1536;

export const esClient = new Client({
  node: env.ELASTICSEARCH_NODE_URL,
  ...(env.ELASTICSEARCH_API_KEY
    ? {
        auth: {
          apiKey: env.ELASTICSEARCH_API_KEY,
        },
      }
    : {}),
});

export const traceIndexId = ({
  traceId,
  projectId,
}: {
  traceId: string;
  projectId: string;
}) => `${projectId}/${traceId}`;

export const spanIndexId = ({
  spanId,
  projectId,
}: {
  spanId: string;
  projectId: string;
}) => `${projectId}/${spanId}`;

export const traceCheckIndexId = ({
  traceId,
  checkId,
  projectId,
}: {
  traceId: string;
  checkId: string;
  projectId: string;
}) => `${projectId}/${traceId}/${checkId}`;

export const eventIndexId = ({
  eventId,
  projectId,
}: {
  eventId: string;
  projectId: string;
}) => `${projectId}/${eventId}`;

export const dspyStepIndexId = ({
  projectId,
  runId,
  index,
}: {
  projectId: string;
  runId: string;
  index: string;
}) => `${projectId}/${runId}/${index}`;
