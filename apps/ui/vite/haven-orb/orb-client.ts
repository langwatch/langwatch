import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { havenEndpoint, postToHaven, snapshotPage } from "./feedback";
import { OrbIsland, type Orb } from "./orb-panel";
import { isHiddenForSession } from "./orb-prefs";
import { attachPageBuffer } from "./page-buffer";
import { orbShell, whenAppPainted } from "./reveal";

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

/** A React island beside the app, on the design system; returns its unmount. */
function mountIsland(orb: Orb): () => void {
  const doc = orb.host.document;
  const shell = orbShell({ doc });
  const root = createRoot(shell);
  const onHide = () => {
    root.unmount();
    shell.remove();
  };
  root.render(
    createElement(DesignSystemProvider, null, createElement(OrbIsland, { orb, shell, onHide })),
  );
  return onHide;
}

/** Injected at the end of the head, after react's preamble; returns what undoes it. */
function start({ host }: { host: Window & typeof globalThis }): () => void {
  const send = host.fetch.bind(host);
  const buffer = attachPageBuffer({ host });
  const orb: Orb = { host, buffer, send, endpoint: havenEndpoint({ location: host.location }) };
  pushEvery(orb);
  let unmount: (() => void) | undefined;
  const stop = () => {
    unmount?.();
    buffer.detach();
  };
  if (isHiddenForSession({ host })) return stop;
  const doc = host.document;
  const reveal = () => whenAppPainted({ doc, onPainted: () => (unmount = mountIsland(orb)) });
  if (doc.readyState !== "loading") reveal();
  else doc.addEventListener("DOMContentLoaded", reveal, { once: true });
  return stop;
}

const stop = start({ host: window });
/** Edits to the orb hot-swap it like app code: the old island and buffer go, the new one mounts. */
import.meta.hot?.dispose(stop);
import.meta.hot?.accept();
