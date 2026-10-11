import type { Outcome } from "../api/playground-outcome.ts";

export function ResponseView({
  outcome,
  retry,
  cancel,
  curl,
}: {
  outcome: Outcome;
  retry: () => void;
  cancel: () => void;
  curl: string;
}) {
  if (outcome.kind === "idle") return null;
  return (
    <section className="docs-response-panel" aria-label="Live response">
      <h2>Live response</h2>
      <div aria-live="polite" className="docs-response-content">
        {outcome.kind === "sending" ? (
          <>
            <p>Waiting for a response...</p>
            <button className="docs-island-button" type="button" onClick={cancel}>
              Cancel
            </button>
          </>
        ) : null}
        {outcome.kind === "error" ? (
          <>
            <p>{outcome.message}</p>
            <button className="docs-island-button" type="button" onClick={retry}>
              Retry
            </button>
            <button className="docs-island-button" type="button" data-docs-copy={curl}>
              Copy curl
            </button>
          </>
        ) : null}
        {outcome.kind === "response" ? (
          <>
            <p>
              {outcome.status} {outcome.statusText} · {outcome.ms} ms · {outcome.contentType}
            </p>
            <pre aria-label="Response body">{prettyBody({ body: outcome.body })}</pre>
          </>
        ) : null}
      </div>
    </section>
  );
}

function prettyBody({ body }: { body: string }) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
