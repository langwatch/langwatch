/*
 * The vendor tags the shared container runs as custom HTML or custom templates, which the docs
 * refuse: loaded here instead, on the same consent, so publishing a tag cannot add code. Each stub
 * is the vendor's own. Kept in step with the marketing site's copy.
 */
export const META_PIXEL_ID = "2744447795854475";
export const REDDIT_PIXEL_ID = "a2_gup7i06m5yzg";
export const X_PIXEL_ID = "p9asd";
export const REO_CLIENT_ID = "a4d64a7a8ea3125";

type Call = (...args: unknown[]) => void;
type MetaQueue = Call & {
  callMethod?: Call;
  push: Call;
  queue: unknown[][];
  loaded: boolean;
  version: string;
};
type RedditQueue = Call & { sendEvent?: Call; callQueue: unknown[][] };
type XQueue = Call & { exe?: Call; queue: unknown[][]; version: string };
type VendorWindow = Window & {
  fbq?: MetaQueue;
  _fbq?: MetaQueue;
  rdt?: RedditQueue;
  twq?: XQueue;
  Reo?: { init: (options: { clientID: string }) => void };
};

function addScript({ win, src, onload }: { win: VendorWindow; src: string; onload?: () => void }) {
  const script = win.document.createElement("script");
  script.async = true;
  script.src = src;
  if (onload) script.onload = onload;
  win.document.head.append(script);
}

/** Meta's pixel: queues until fbevents.js loads, then hands it each call; a page view on start. */
export function loadMetaPixel({ win = window }: { win?: VendorWindow } = {}) {
  if (win.fbq) return;
  const fbq = ((...args: unknown[]) => {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  }) as MetaQueue;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";
  fbq.queue = [];
  win.fbq = fbq;
  win._fbq = fbq;
  addScript({ win, src: "https://connect.facebook.net/en_US/fbevents.js" });
  fbq("init", META_PIXEL_ID);
  fbq("track", "PageView");
}

/** Reddit's pixel: queues until pixel.js loads, then hands it each call; a page visit on start. */
export function loadRedditPixel({ win = window }: { win?: VendorWindow } = {}) {
  if (win.rdt) return;
  const rdt = ((...args: unknown[]) => {
    if (rdt.sendEvent) rdt.sendEvent(...args);
    else rdt.callQueue.push(args);
  }) as RedditQueue;
  rdt.callQueue = [];
  win.rdt = rdt;
  addScript({ win, src: "https://www.redditstatic.com/ads/pixel.js" });
  rdt("init", REDDIT_PIXEL_ID);
  rdt("track", "PageVisit");
}

/** X's pixel: queues until uwt.js loads, then hands each call to it; configured on start. */
export function loadXPixel({ win = window }: { win?: VendorWindow } = {}) {
  if (win.twq) return;
  const twq = ((...args: unknown[]) => {
    if (twq.exe) twq.exe(...args);
    else twq.queue.push(args);
  }) as XQueue;
  twq.version = "1.1";
  twq.queue = [];
  win.twq = twq;
  addScript({ win, src: "https://static.ads-twitter.com/uwt.js" });
  twq("config", X_PIXEL_ID);
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
