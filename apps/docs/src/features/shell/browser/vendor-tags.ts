/*
 * The two vendor tags the shared container runs as Custom HTML, which the docs refuse: loaded here
 * instead, with the tag manager and on the same consent, so publishing a tag cannot add code.
 */
export const META_PIXEL_ID = "2744447795854475";
export const REO_CLIENT_ID = "a4d64a7a8ea3125";

type Queue = ((...args: unknown[]) => void) & {
  queue: unknown[][];
  loaded: boolean;
  version: string;
};
type VendorWindow = Window & {
  fbq?: Queue;
  _fbq?: Queue;
  Reo?: { init: (options: { clientID: string }) => void };
};

function addScript({ win, src, onload }: { win: VendorWindow; src: string; onload?: () => void }) {
  const script = win.document.createElement("script");
  script.async = true;
  script.src = src;
  if (onload) script.onload = onload;
  win.document.head.append(script);
}

/** Meta's pixel: its queue, then its loader, which replays the queue; a page view on start. */
export function loadMetaPixel({ win = window }: { win?: VendorWindow } = {}) {
  if (win.fbq) return;
  const fbq = Object.assign((...args: unknown[]) => fbq.queue.push(args), {
    queue: [] as unknown[][],
    loaded: true,
    version: "2.0",
  });
  win.fbq = fbq;
  win._fbq = fbq;
  addScript({ win, src: "https://connect.facebook.net/en_US/fbevents.js" });
  fbq("init", META_PIXEL_ID);
  fbq("track", "PageView");
}

/** Reo.dev's script, started with the LangWatch client id once it has loaded. */
export function loadReo({ win = window }: { win?: VendorWindow } = {}) {
  if (win.Reo) return;
  addScript({
    win,
    src: `https://static.reo.dev/${REO_CLIENT_ID}/reo.js`,
    onload: () => win.Reo?.init({ clientID: REO_CLIENT_ID }),
  });
}
