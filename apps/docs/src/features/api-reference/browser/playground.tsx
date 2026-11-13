import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { z } from "zod/mini";

import { generateExample, liveRequest } from "../model/codegen.ts";
import { frameRequest, sessionCovers, type FrameFailure } from "../model/docs-session.ts";
import { operationSchema } from "../model/operation-schema.ts";
import type { Operation } from "../model/operation.ts";
import { requestErrorOutcome } from "../model/playground-outcome.ts";
import type { Outcome } from "../model/playground-outcome.ts";
import { validateRequest } from "../model/request-validation.ts";
import type * as BodyForm from "./body-form.ts";
import { frameConnection, sendThroughFrame, type FrameAnswer } from "./docs-session.ts";
import { editManualKey, fieldValue, setFormOpen, showErrors, syncBody } from "./playground-dom.ts";
import type * as RequestValues from "./request-values.ts";
import { ResponseView } from "./response-view.tsx";
import { startSession } from "./session-controls.ts";

type RequestTools = typeof BodyForm & typeof RequestValues;

/* Typed fields load after the first click; the prerendered form stays usable, and every edit
   made meanwhile queues on this one promise, so nothing typed before it lands is lost. */
let requestTools: Promise<RequestTools> | undefined;
function loadRequestTools(): Promise<RequestTools> {
  requestTools ??= Promise.all([import("./body-form.ts"), import("./request-values.ts")]).then(
    ([form, values]) => ({ ...form, ...values }),
  );
  return requestTools;
}

/** The typed fields once they have loaded, for what renders from them. */
function useRequestTools() {
  const [tools, setTools] = useState<RequestTools | null>(null);
  useEffect(() => {
    let live = true;
    void loadRequestTools().then((loaded) => {
      if (live) setTools(loaded);
    });
    return () => {
      live = false;
    };
  }, []);
  return tools;
}

/** After a field changes: the form into the body when it was the form, then every example. */
async function syncEdit({ operation, inForm }: { operation: Operation; inForm: boolean }) {
  const { syncFormToBody, updateExamples } = await loadRequestTools();
  if (inForm) syncFormToBody({ operation });
  updateExamples({ operation });
}

/** The Form | JSON switch and a list's Add and Remove. */
async function editBody({ operation, button }: { operation: Operation; button: Element }) {
  const { setBodyMode, editRows } = await loadRequestTools();
  const mode = button.getAttribute("data-body-mode-button");
  if (mode === "form" || mode === "json") setBodyMode({ operation, mode });
  if (editRows({ button })) await syncEdit({ operation, inForm: true });
}

/** What the reader is told when the session frame did not send the request. */
const FRAME_FAILURES: Record<FrameFailure, string> = {
  "not-connected": "Your access ended. Connect again, or paste an API key.",
  declined: "You canceled this request in the LangWatch frame, so it was not sent.",
  refused: "LangWatch would not send this request from the docs.",
  timeout: "Request timed out",
  cancelled: "Request canceled",
  network: "The browser could not reach this endpoint. Copy the curl request to run it locally.",
};

function frameOutcome({ answer }: { answer: FrameAnswer }): Outcome {
  if (answer.kind === "failed")
    return { kind: "error", message: FRAME_FAILURES[answer.reason], retry: true };
  return {
    kind: "response",
    status: answer.status,
    statusText: answer.statusText,
    contentType: answer.contentType,
    ms: answer.ms,
    body: answer.body,
    headers: answer.headers,
  };
}

/** Sends from this page with the pasted key; null once the send was cancelled by a newer one. */
async function sendDirect({
  operation,
  request,
  abort,
}: {
  operation: Operation;
  request: ReturnType<typeof liveRequest>;
  abort: AbortController;
}): Promise<Outcome | null> {
  const timer = window.setTimeout(() => abort.abort("timeout"), 30_000);
  const started = performance.now();
  try {
    const response = await fetch(request.url, {
      method: operation.method,
      headers: request.headers,
      body: request.body,
      signal: abort.signal,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    const body = await response.text();
    if (abort.signal.aborted) return null;
    return {
      kind: "response",
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type") ?? "unknown",
      ms: Math.round(performance.now() - started),
      body,
      headers: [...response.headers.entries()],
    };
  } catch {
    return requestErrorOutcome({ signal: abort.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function PlaygroundRuntime({ operation }: { operation: Operation }) {
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const tools = useRequestTools();
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      editManualKey({ action: "Clear" });
    },
    [],
  );
  const send = async () => {
    pending.current?.abort();
    const abort = new AbortController();
    pending.current = abort;
    const { syncFormToBody, requestState, paramErrors, readForm } = await loadRequestTools();
    /* A page change while the tools load cancels this send before anything is read. */
    if (abort.signal.aborted) return;
    syncFormToBody({ operation });
    const state = requestState({ operation });
    /* Signed in, the frame sends as the reader and this page never holds the key. */
    const viaFrame = sessionCovers({ scheme: operation.schemes[0] }) && frameConnection() !== null;
    const key = fieldValue({ id: "pg-auth" });
    const fieldErrors = {
      ...paramErrors({ operation }),
      ...readForm({ operation })?.errors,
    };
    const errors = validateRequest({
      operation,
      state,
      key: viaFrame ? { from: "frame" } : key,
      fieldErrors,
    });
    showErrors({ errors });
    if (Object.keys(errors).length) return;
    setOutcome({ kind: "sending" });
    if (viaFrame) {
      const answer = await sendThroughFrame({
        request: frameRequest({ operation, state }),
        signal: abort.signal,
      });
      if (pending.current === abort) setOutcome(frameOutcome({ answer }));
      return;
    }
    const answer = await sendDirect({
      operation,
      request: liveRequest({ operation, state, key }),
      abort,
    });
    if (pending.current === abort && answer) setOutcome(answer);
  };
  useEffect(() => {
    const button = document.getElementById("pg-send");
    if (button instanceof HTMLButtonElement) button.disabled = outcome.kind === "sending";
  }, [outcome.kind]);
  useEffect(() => {
    return bindRequestForm({ operation, onSend: send });
  });
  useEffect(() => {
    if (outcome.kind === "idle") return;
    const smooth = matchMedia("(prefers-reduced-motion: no-preference)").matches;
    document
      .querySelector("[data-docs-runtime]")
      ?.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "instant" });
  }, [outcome.kind]);
  return (
    <ResponseView
      outcome={outcome}
      retry={() => void send()}
      cancel={() => pending.current?.abort("cancel")}
      curl={
        tools
          ? generateExample({
              operation,
              state: tools.requestState({ operation }),
              language: "curl",
            })
          : ""
      }
    />
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
    const slot =
      document.querySelector("[data-docs-response-slot]") ??
      document.querySelector("[data-docs-playground]");
    slot?.append(container);
    root = createRoot(container);
    root.render(<PlaygroundRuntime operation={data.operation} />);
    startSession();
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
  const input = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.id === "pg-body") syncBody();
    void syncEdit({ operation, inForm: Boolean(target?.closest("[data-body-form]")) });
  };
  const click = (event: Event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button) return;
    if (button.id === "pg-send") void onSend();
    if (button.matches("[data-body-mode-button]") || button.closest("[data-body-list]"))
      void editBody({ operation, button });
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
