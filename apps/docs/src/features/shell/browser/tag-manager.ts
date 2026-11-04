import { loadPostHog } from "./posthog.ts";
import { loadMetaPixel, loadRedditPixel, loadReo, loadXPixel } from "./vendor-tags.ts";

const INTERACTIONS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/;
/* The host the container fired its ad pixels on; a preview host sends them nothing. */
const AD_PIXEL_HOST = "langwatch.ai";

/* The marketing site's cookie banner writes the reader's choice here, on the same origin. */
const CONSENT_STORAGE_KEY = "lw-cookie-consent";

/*
 * Set by the page before the container loads, so publishing cannot widen it: no Custom HTML and
 * no custom JavaScript, which run any code at all. Blocking a class also refuses every custom
 * template, which could grant itself any script; Google's built-in tags still run.
 */
export const TAG_RESTRICTIONS = { "gtm.blocklist": ["html", "customScripts"] } as const;

type TagWindow = Window & { dataLayer?: unknown[] };

/** Whether the reader accepted cookies; unknown, declined or unreadable storage is a no. */
export function analyticsConsented({ win }: { win: Pick<Window, "localStorage"> }) {
  try {
    return win.localStorage.getItem(CONSENT_STORAGE_KEY) === "accepted";
  } catch {
    return false;
  }
}

/** The container a production page names; none in development or on a local host. */
export function tagManagerId({ doc, host }: { doc: Document; host: string }) {
  const id = doc.querySelector<HTMLMetaElement>('meta[name="docs-gtm"]')?.content ?? "";
  return /^GTM-[A-Z0-9]+$/.test(id) && !LOCAL_HOST.test(host) ? id : "";
}

/** The vendor tags the container would have run; the ad pixels only where it fired them. */
function loadVendorTags({ win }: { win: TagWindow }) {
  if (win.location.hostname === AD_PIXEL_HOST) {
    loadMetaPixel({ win });
    loadRedditPixel({ win });
    loadXPixel({ win });
  }
  loadReo({ win });
}

/**
 * Adds Google Tag Manager and PostHog once, when the reader first interacts or the page is idle,
 * and only after they accepted cookies. Accepting in another tab starts them here too.
 */
export function startTagManager({ win = window }: { win?: TagWindow } = {}) {
  const id = tagManagerId({ doc: win.document, host: win.location.hostname });
  if (!id) return;
  if (!analyticsConsented({ win })) {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CONSENT_STORAGE_KEY || !analyticsConsented({ win })) return;
      win.removeEventListener("storage", onStorage);
      startTagManager({ win });
    };
    win.addEventListener("storage", onStorage);
    return;
  }
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    for (const name of INTERACTIONS) win.removeEventListener(name, start);
    win.dataLayer = win.dataLayer ?? [];
    win.dataLayer.push(TAG_RESTRICTIONS);
    // The performance clock gives epoch milliseconds without pulling Temporal into this island.
    const epochMilliseconds = Math.round(performance.timeOrigin + performance.now());
    win.dataLayer.push({ "gtm.start": epochMilliseconds, event: "gtm.js" });
    const script = win.document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
    win.document.head.append(script);
    loadPostHog({ win });
    loadVendorTags({ win });
  };
  for (const name of INTERACTIONS) win.addEventListener(name, start, { once: true, passive: true });
  const idle = () =>
    typeof win.requestIdleCallback === "function"
      ? win.requestIdleCallback(start, { timeout: 4000 })
      : win.setTimeout(start, 2000);
  if (win.document.readyState === "complete") idle();
  else win.addEventListener("load", idle, { once: true });
}
