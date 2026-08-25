import { pollForGlobal } from "./pollForGlobal";

/**
 * Polling for gtag runs for up to ten seconds, long enough for the page to be
 * gone by the time a tick lands. Reading a bare `window` there throws a
 * ReferenceError from inside a timer, where the caller that started the poll is
 * no longer on the stack to catch it.
 */
const getGtag = (): ((...args: any[]) => void) | undefined =>
  typeof window === "undefined" ? void 0 : (window as any).gtag;

export const trackEvent = (
  eventName: string,
  params: Record<string, any> | undefined,
) => {
  if (typeof window === "undefined") return;

  const send = (gtag: (...args: any[]) => void) => {
    if (params) {
      gtag("event", eventName, params);
    } else {
      gtag("event", eventName);
    }
  };

  const gtag = getGtag();
  if (gtag) {
    send(gtag);
    return;
  }

  // gtag may not exist yet if GTM's script is still idle-deferred, so poll for
  // it instead of dropping the event outright.
  pollForGlobal(getGtag, send);
};

const eventsTracked =
  typeof window !== "undefined"
    ? JSON.parse(window.localStorage?.getItem("events_tracked") ?? "[]")
    : [];

const pendingOnceEvents = new Set<string>();

export const trackEventOnce = (eventName: string, params: Record<string, any>) => {
  if (typeof window === "undefined") return;
  if (eventsTracked.includes(eventName) || pendingOnceEvents.has(eventName)) {
    return;
  }

  const markSent = () => {
    eventsTracked.push(eventName);
    window.localStorage.setItem("events_tracked", JSON.stringify(eventsTracked));
    pendingOnceEvents.delete(eventName);
  };

  const gtag = getGtag();
  if (gtag) {
    trackEvent(eventName, params);
    markSent();
    return;
  }

  // Don't mark as tracked until gtag actually exists and the event is sent —
  // otherwise a miss during GTM's idle-deferred load would be recorded as
  // "sent" in localStorage and never retried.
  pendingOnceEvents.add(eventName);
  pollForGlobal(getGtag, () => {
    trackEvent(eventName, params);
    markSent();
  });
};
