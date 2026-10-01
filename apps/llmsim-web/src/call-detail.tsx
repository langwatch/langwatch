import { SimCode, SimEmpty, SimJson, SimRefusal } from "@langwatch/sim-console";
import { useEffect, useState } from "react";

import { type CallDetail, fetchCall } from "./llm-api.ts";

/**
 * One recorded call: what was asked, and what llmsim answered. A call never
 * changes, so it loads once.
 */
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
    <div className="llm-detail" data-testid="call-detail">
      <div className="llm-facts">
        <strong>{call.model || "(no model)"}</strong>
        <span className="llm-muted">
          {call.dialect} · {call.path} · {call.mode || "refused"}
          {reply ? ` · finish ${reply.finish}` : ""}
        </span>
      </div>
      {call.error ? <SimRefusal message={call.error} /> : null}
      {reply?.text ? (
        <SimCode text={reply.text} language={reply.mode === "json" ? "json" : undefined} />
      ) : null}
      {reply?.calls?.map((toolCall) => (
        <SimCode key={toolCall.id} text={`${toolCall.name}(${toolCall.arguments})`} />
      ))}
      <SimJson value={call.request} />
    </div>
  );
};
