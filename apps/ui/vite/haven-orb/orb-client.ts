import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { havenEndpoint, postToHaven, snapshotPage } from "./feedback";
import { OrbIsland, type Orb } from "./orb-panel";
import { isHiddenForSession } from "./orb-prefs";
import { attachPageBuffer } from "./page-buffer";

/** The orb pushes the page buffer to haven at most this often, for `haven page`. */
const PUSH_EVERY_MS = 2_000;

const pushEvery = ({ host, buffer, send, endpoint }: Orb) => {
  let pending: number | undefined;
  buffer.subscribe({
    listener: () => {
      if (pending !== undefined) return;
      pending = host.setTimeout(() => {
        pending = undefined;
        const body = snapshotPage({ buffer, href: host.location.href });
        void postToHaven({ send, url: `${endpoint.base}/page`, body });
      }, PUSH_EVERY_MS);
    },
  });
};

/** A React island beside the app, on the design system, so the orb looks like the product. */
function mountIsland(orb: Orb) {
  const doc = orb.host.document;
  const shell = doc.createElement("div");
  shell.setAttribute("data-haven-orb", "");
  doc.body.append(shell);
  const root = createRoot(shell);
  const onHide = () => {
    root.unmount();
    shell.remove();
  };
  root.render(
    createElement(DesignSystemProvider, null, createElement(OrbIsland, { orb, shell, onHide })),
  );
}

/** Injected first in the head by the dev server, so the buffer sees the first request. */
function start({ host }: { host: Window & typeof globalThis }) {
  const send = host.fetch.bind(host);
  const buffer = attachPageBuffer({ host });
  const orb: Orb = { host, buffer, send, endpoint: havenEndpoint({ location: host.location }) };
  pushEvery(orb);
  if (isHiddenForSession({ host })) return;
  if (host.document.readyState === "loading") {
    host.document.addEventListener("DOMContentLoaded", () => mountIsland(orb), { once: true });
    return;
  }
  mountIsland(orb);
}

start({ host: window });
