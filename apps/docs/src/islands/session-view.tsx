import { Link2 } from "lucide-react";

import type { SessionView } from "../auth/session-controller.ts";

export function SessionViewContent({
  view,
  selected,
  connect,
  disconnect,
}: {
  view: SessionView;
  selected: boolean;
  connect: () => void;
  disconnect: () => void;
}) {
  return (
    <>
      <p className="docs-session-title">LangWatch session</p>
      <p className="docs-session-description">
        Demo only. Try a short-lived connection to one project. Requests are simulated.
      </p>
      <output aria-live="polite" className="docs-session-status" data-selected={selected}>
        {view.kind === "ready" ? (
          <>
            <strong>{view.projectName}</strong>
            <span>
              Trace reading · Expires at{" "}
              {new Intl.DateTimeFormat(void 0, { timeStyle: "medium" }).format(view.expiresAt)}
            </span>
          </>
        ) : null}
        {view.kind === "expired" ? "Session expired. Connect again to continue." : null}
        {view.kind === "error" ? view.message : null}
        {view.kind === "connecting" ? "Connecting…" : null}
      </output>
      <div className="docs-session-actions">
        {view.kind !== "ready" ? (
          <button
            className="docs-island-button"
            type="button"
            disabled={view.kind === "connecting"}
            onClick={connect}
          >
            <Link2 size={16} aria-hidden="true" /> Use my LangWatch session
          </button>
        ) : null}
        {selected ? (
          <button
            className="docs-island-button docs-button-ghost"
            type="button"
            onClick={disconnect}
          >
            {view.kind === "connecting" ? "Cancel connection" : "Disconnect"}
          </button>
        ) : null}
      </div>
    </>
  );
}
