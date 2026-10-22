const INTERACTIONS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/;

type TagWindow = Window & { dataLayer?: unknown[] };

/** The container a production page names; none in development or on a local host. */
export function tagManagerId({ doc, host }: { doc: Document; host: string }) {
  const id = doc.querySelector<HTMLMetaElement>('meta[name="docs-gtm"]')?.content ?? "";
  return /^GTM-[A-Z0-9]+$/.test(id) && !LOCAL_HOST.test(host) ? id : "";
}

/** Adds Google Tag Manager once, when the reader first interacts or the page is idle. */
export function startTagManager({ win = window }: { win?: TagWindow } = {}) {
  const id = tagManagerId({ doc: win.document, host: win.location.hostname });
  if (!id) return;
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    for (const name of INTERACTIONS) win.removeEventListener(name, start);
    win.dataLayer = win.dataLayer ?? [];
    win.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    const script = win.document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
    win.document.head.append(script);
  };
  for (const name of INTERACTIONS) win.addEventListener(name, start, { once: true, passive: true });
  const idle = () =>
    typeof win.requestIdleCallback === "function"
      ? win.requestIdleCallback(start, { timeout: 4000 })
      : win.setTimeout(start, 2000);
  if (win.document.readyState === "complete") idle();
  else win.addEventListener("load", idle, { once: true });
}
