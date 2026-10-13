import { Badge, KeyValue, Panel, Stack, Text } from "@langwatch/design-system-internal";
import { SimCode } from "@langwatch/sim-console";

import { statusMeaning, type SendOneAnswer } from "./telemetry-api.ts";

const toneOf = ({ status }: { status: number }) => {
  if (status === 0) return "error";
  if (status < 300) return "ok";
  return status === 429 || status === 503 ? "warn" : "error";
};

/** How the OTLP door answered one request: status, Retry-After, latency and its body. */
export const SendOneAnswerPanel = ({ answer }: { answer: SendOneAnswer }) => (
  <article data-testid="send-one-answer">
    <Stack gap={4}>
      <Panel
        title="The door's answer"
        meta={
          <Badge tone={toneOf(answer)}>
            {answer.status === 0
              ? "No answer"
              : `${answer.status} ${statusMeaning[String(answer.status)] ?? ""}`}
          </Badge>
        }
      >
        <KeyValue
          items={[
            { label: "URL", value: answer.url },
            {
              label: "Sent",
              value: `${answer.signal}, ${answer.encoding}${answer.gzip ? ", gzip" : ""}, ${answer.bytes} bytes`,
              copy: false,
            },
            { label: "Latency", value: `${answer.latencyMs.toFixed(1)} ms`, copy: false },
            ...(answer.retryAfter ? [{ label: "Retry-After", value: answer.retryAfter }] : []),
            ...(answer.contentType
              ? [{ label: "Content-Type", value: answer.contentType, copy: false }]
              : []),
            ...(answer.error ? [{ label: "Error", value: answer.error }] : []),
          ]}
        />
      </Panel>
      <Panel title="Body">
        {answer.body ? (
          <SimCode text={answer.body} />
        ) : (
          <Text tone="muted">The door answered with no body.</Text>
        )}
      </Panel>
    </Stack>
  </article>
);
