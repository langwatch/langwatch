import { Badge, CodeBlock, KeyValue, Panel, Stack } from "@langwatch/design-system-internal";
import { SimEmpty, SimRefusal, SimTime } from "@langwatch/sim-console";
import { useEffect, useState } from "react";

import { type CallDetail, fetchCall } from "./llm-api.ts";
import { type ChatMessage, requestMessages } from "./request-messages.ts";

const Turn = ({ message }: { message: ChatMessage }) => (
  <div className="llm-turn" data-role={message.role}>
    <Badge tone={message.role === "assistant" ? "brand" : "neutral"}>{message.role}</Badge>
    <pre className="llm-text">{message.text}</pre>
  </div>
);

const Conversation = ({ call }: { call: CallDetail }) => {
  const reply = call.response;
  const turns = requestMessages({ request: call.request });
  return (
    <Panel title="Conversation" meta={`${turns.length} in, ${reply ? 1 : 0} out`}>
      <Stack gap={3}>
        {turns.length === 0 ? (
          <SimEmpty title="No readable messages" hint="The raw request below has the full body." />
        ) : (
          turns.map((message, index) => <Turn key={index} message={message} />)
        )}
        {reply?.text ? <Turn message={{ role: "assistant", text: reply.text }} /> : null}
        {reply?.calls?.map((toolCall) => (
          <Turn
            key={toolCall.id}
            message={{ role: "tool call", text: `${toolCall.name}(${toolCall.arguments})` }}
          />
        ))}
      </Stack>
    </Panel>
  );
};

/** One recorded call, asked and answered. A call never changes, so it loads once. */
export const CallDetailPane = ({ id }: { id: string }) => {
  const [call, setCall] = useState<CallDetail>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    setCall(undefined);
    setError(undefined);
    void fetchCall({ id }).then(
      (loaded) => {
        if (current) setCall(loaded);
      },
      (failure: unknown) => {
        if (current) setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [id]);

  if (error) return <SimRefusal message={error} />;
  if (!call) return <SimEmpty title="Loading the call" />;
  const reply = call.response;

  return (
    <div data-testid="call-detail">
      <Stack gap={4}>
        <Panel title={call.model || "(no model)"} meta={<SimTime at={call.at} />}>
          <KeyValue
            items={[
              { label: "Provider", value: call.dialect, copy: false },
              { label: "Path", value: call.path },
              { label: "Status", value: String(call.status), copy: false },
              { label: "Mode", value: call.mode || "refused", copy: false },
              { label: "Finish", value: reply?.finish ?? "", copy: false },
              {
                label: "Tokens",
                value: `${call.inputTokens} in, ${call.outputTokens} out`,
                copy: false,
              },
              {
                label: "Latency",
                value: `${Math.round(call.latencyMs)} ms${call.stream ? ", streamed" : ""}`,
                copy: false,
              },
            ]}
          />
        </Panel>
        {call.error ? <SimRefusal message={call.error} /> : null}
        <Conversation call={call} />
        <details className="sim-json">
          <summary>Raw request JSON</summary>
          <CodeBlock code={JSON.stringify(call.request, null, 2)} label="JSON" wrap />
        </details>
        {reply ? (
          <details className="sim-json">
            <summary>Raw reply JSON</summary>
            <CodeBlock code={JSON.stringify(reply, null, 2)} label="JSON" wrap />
          </details>
        ) : null}
      </Stack>
    </div>
  );
};
