export const trackEvent = (
  eventName: string,
  params: Record<string, any> | undefined
) => {
  if (typeof window === "undefined") return;

  const gtag = (window as any).gtag;
  if (!gtag) return;

  if (params) {
    gtag("event", eventName, params);
  } else {
    gtag("event", eventName);
  }
};

const eventsTracked =
  typeof window !== "undefined"
    ? JSON.parse(window.localStorage?.getItem("events_tracked") ?? "[]")
    : [];

export const trackEventOnce = (
  eventName: string,
  params: Record<string, any>
) => {
  if (typeof window === "undefined") return;
  if (eventsTracked.includes(eventName)) {
    return;
  }

  trackEvent(eventName, params);
  eventsTracked.push(eventName);
  window.localStorage.setItem("events_tracked", JSON.stringify(eventsTracked));
};
