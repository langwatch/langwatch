import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { z } from "zod/mini";

import { SessionViewContent } from "../../session/browser/session-view.tsx";
import { useDocsSession } from "../../session/ui/use-docs-session.ts";
import { generateExample, liveRequest } from "../model/codegen.ts";
import { operationSchema } from "../model/operation-schema.ts";
import type { Operation } from "../model/operation.ts";
import { requestErrorOutcome } from "../model/playground-outcome.ts";
import type { Outcome } from "../model/playground-outcome.ts";
import { validateRequest } from "../model/request-validation.ts";
import {
  editManualKey,
  fieldValue,
  requestState,
  setFormOpen,
  showErrors,
  updateExamples,
} from "./playground-dom.ts";
import { ResponseView } from "./response-view.tsx";

function PlaygroundRuntime({ operation }: { operation: Operation }) {
  const session = useDocsSession();
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const pending = useRef<AbortController | null>(null);
  const slot = document.querySelector("[data-docs-session]");
  const manualAuth = useRef(document.getElementById("pg-auth")?.closest("details") ?? null);
  useEffect(
    () => () => {
      pending.current?.abort();
      editManualKey({ action: "Clear" });
    },
    [],
  );
  const send = async () => {
    const state = requestState({ operation });
    const key = fieldValue({ id: "pg-auth" });
    const errors = validateRequest({ operation, state, key, hasSession: session.selected });
    showErrors({ errors });
    if (Object.keys(errors).length) return;
    const request = liveRequest({ operation, state, key });
    pending.current?.abort();
    const abort = new AbortController();
    pending.current = abort;
    const timer = window.setTimeout(() => abort.abort("timeout"), 30_000);
    const started = performance.now();
    setOutcome({ kind: "sending" });
    try {
      const response =
        session.selected && session.controller
          ? await session.controller.send({ operation, state, signal: abort.signal })
          : await fetch(request.url, {
              method: operation.method,
              headers: request.headers,
              body: request.body,
              signal: abort.signal,
              credentials: "omit",
              redirect: "error",
              cache: "no-store",
            });
      const body = await response.text();
      if (abort.signal.aborted) return;
      setOutcome({
        kind: "response",
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type") ?? "unknown",
        ms: Math.round(performance.now() - started),
        body,
        headers: [...response.headers.entries()],
      });
    } catch (error) {
      if (pending.current === abort)
        setOutcome(requestErrorOutcome({ error, signal: abort.signal }));
    } finally {
      window.clearTimeout(timer);
    }
  };
  useEffect(() => {
    if (session.selected) manualAuth.current?.remove();
    else if (manualAuth.current && slot) slot.insertAdjacentElement("afterend", manualAuth.current);
    const button = document.getElementById("pg-send");
    if (button instanceof HTMLButtonElement)
      button.disabled =
        outcome.kind === "sending" || (session.selected && session.view.kind !== "ready");
    if (session.selected && session.view.kind !== "ready") {
      pending.current?.abort();
      setOutcome({ kind: "idle" });
    }
  }, [session.selected, session.view.kind, outcome.kind, slot]);
  useEffect(() => {
    return bindRequestForm({ operation, onSend: send });
  });
  const connect = () => {
    pending.current?.abort();
    editManualKey({ action: "Clear" });
    showErrors({ errors: {} });
    setOutcome({ kind: "idle" });
    void session.connect();
  };
  const disconnect = () => {
    pending.current?.abort();
    setOutcome({ kind: "idle" });
    void session.disconnect();
  };
  return (
    <>
      {slot && session.controller
        ? createPortal(
            <SessionViewContent
              view={session.view}
              selected={session.selected}
              connect={connect}
              disconnect={disconnect}
            />,
            slot,
          )
        : null}
      <ResponseView
        outcome={outcome}
        retry={() => void send()}
        cancel={() => pending.current?.abort("cancel")}
        curl={generateExample({ operation, state: requestState({ operation }), language: "curl" })}
      />
    </>
  );
}

let root: Root | null = null;
function activate() {
  if (!root) {
    const data = z
      .object({ operation: operationSchema })
      .parse(JSON.parse(document.getElementById("docs-page-data")?.textContent ?? "{}"));
    const container = document.createElement("div");
    container.dataset.docsRuntime = "";
    document.querySelector("[data-docs-playground]")?.append(container);
    document.querySelector("[data-docs-session]")?.replaceChildren();
    root = createRoot(container);
    root.render(<PlaygroundRuntime operation={data.operation} />);
  }
  setFormOpen({
    open: document.getElementById("try-it-button")?.getAttribute("aria-expanded") !== "true",
  });
}
document.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("#try-it-button")) activate();
});
document.addEventListener("docs:leaving", () => {
  root?.unmount();
  root = null;
});

function bindRequestForm({
  operation,
  onSend,
}: {
  operation: Operation;
  onSend: () => Promise<void>;
}) {
  const form = document.getElementById("try-it-form");
  const input = () => updateExamples({ operation });
  const click = (event: Event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button) return;
    if (button.id === "pg-send") void onSend();
    if (button.getAttribute("aria-label") === "Close request form") setFormOpen({ open: false });
    const label = button.getAttribute("aria-label") ?? button.textContent?.trim();
    if (label && ["Clear", "Reveal key", "Hide key"].includes(label))
      editManualKey({ action: label });
  };
  form?.addEventListener("input", input);
  form?.addEventListener("change", input);
  form?.addEventListener("click", click);
  return () => {
    form?.removeEventListener("input", input);
    form?.removeEventListener("change", input);
    form?.removeEventListener("click", click);
  };
}
