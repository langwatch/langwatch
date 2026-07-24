import { pollForGlobal } from "./pollForGlobal";

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

  const gtag = (window as any).gtag;
  if (gtag) {
    send(gtag);
    return;
  }

  // gtag may not exist yet if GTM's script is still idle-deferred — poll for
  // it instead of dropping the event outright.
  pollForGlobal(() => (window as any).gtag, send);
};

const eventsTracked =
  typeof window !== "undefined"
    ? JSON.parse(window.localStorage?.getItem("events_tracked") ?? "[]")
    : [];

const pendingOnceEvents = new Set<string>();

export const trackEventOnce = (
  eventName: string,
  params: Record<string, any>,
) => {
  if (typeof window === "undefined") return;
  if (eventsTracked.includes(eventName) || pendingOnceEvents.has(eventName)) {
    return;
  }

  const markSent = () => {
    eventsTracked.push(eventName);
    window.localStorage.setItem(
      "events_tracked",
      JSON.stringify(eventsTracked),
    );
    pendingOnceEvents.delete(eventName);
  };

  const gtag = (window as any).gtag;
  if (gtag) {
    trackEvent(eventName, params);
    markSent();
    return;
  }

  // Don't mark as tracked until gtag actually exists and the event is sent —
  // otherwise a miss during GTM's idle-deferred load would be recorded as
  // "sent" in localStorage and never retried.
  pendingOnceEvents.add(eventName);
  pollForGlobal(
    () => (window as any).gtag,
    () => {
      trackEvent(eventName, params);
      markSent();
    },
  );
};
