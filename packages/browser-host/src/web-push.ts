/**
 * Web Push from the page's side: support, this browser's subscription and the tab's answers
 * to the service worker. The server sends; the page only subscribes.
 * Spec: specs/langy/langy-notifications.feature
 */
import { useSyncExternalStore } from "react";

import { PUSH_OPEN_MESSAGE, PUSH_SHOWS_MESSAGE } from "./push-service-worker.ts";

/** Where the UI build serves the worker, and the scope it controls. */
export const PUSH_SERVICE_WORKER_URL = "/push-sw.js";

/**
 * This browser's standing for Web Push. Only `unavailable` (no push support, or subscribing
 * failed) lets a feature notify from the tab; `subscribed` leaves it to pushes.
 */
export type WebPushDeviceState = "unknown" | "subscribed" | "unsubscribed" | "unavailable";

let deviceState: WebPushDeviceState = "unknown";
const listeners = new Set<() => void>();

function setDeviceState(next: WebPushDeviceState): void {
  if (next === deviceState) return;
  deviceState = next;
  for (const listener of listeners) listener();
}

export function readWebPushDeviceState(): WebPushDeviceState {
  return deviceState;
}

/** This browser's Web Push standing as React state. */
export function useWebPushDeviceState(): WebPushDeviceState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readWebPushDeviceState,
    readWebPushDeviceState,
  );
}

/** A secure page in a browser with service workers, the Push API and notifications. */
export function isWebPushSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return (
    window.isSecureContext === true &&
    "serviceWorker" in navigator &&
    typeof window.PushManager === "function" &&
    typeof globalThis.Notification === "function"
  );
}

/** Whether this browser can hold a push subscription; one that cannot is `unavailable`. */
export function checkWebPushSupport(): boolean {
  const supported = isWebPushSupported();
  if (!supported) setDeviceState("unavailable");
  return supported;
}

let registration: Promise<ServiceWorkerRegistration> | null = null;

function pushRegistration(): Promise<ServiceWorkerRegistration> {
  registration ??= navigator.serviceWorker
    .register(PUSH_SERVICE_WORKER_URL, { scope: "/" })
    .then(() => navigator.serviceWorker.ready)
    .catch((error: unknown) => {
      registration = null;
      throw error;
    });
  return registration;
}

function toBase64Url(buffer: ArrayBuffer | null): string | null {
  if (!buffer) return null;
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** A browser subscription as the server stores it. */
export interface WebPushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function toJson(subscription: PushSubscription): WebPushSubscriptionJson | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

/**
 * This browser's subscription for the VAPID key, reused or made, with permission already
 * granted. A subscription marks the device `subscribed`; null marks it `unavailable`.
 */
export async function ensureWebPushSubscription(
  applicationServerKey: string,
): Promise<WebPushSubscriptionJson | null> {
  const subscription = await subscribeBrowser(applicationServerKey);
  setDeviceState(subscription ? "subscribed" : "unavailable");
  return subscription;
}

async function subscribeBrowser(
  applicationServerKey: string,
): Promise<WebPushSubscriptionJson | null> {
  if (!isWebPushSupported()) return null;
  try {
    const worker = await pushRegistration();
    const existing = await worker.pushManager.getSubscription();
    if (existing && toBase64Url(existing.options.applicationServerKey) === applicationServerKey) {
      return toJson(existing);
    }
    await existing?.unsubscribe();
    const created = await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromBase64Url(applicationServerKey),
    });
    return toJson(created);
  } catch {
    return null;
  }
}

/**
 * Drops this browser's subscription; answers its endpoint, for the server to forget it.
 * `unusable` says the server will never push to it, so the device falls back to the tab.
 */
export async function removeWebPushSubscription({
  unusable = false,
}: { unusable?: boolean } = {}): Promise<string | null> {
  setDeviceState(unusable ? "unavailable" : "unsubscribed");
  if (!isWebPushSupported()) return null;
  try {
    const worker = await navigator.serviceWorker.getRegistration("/");
    const existing = await worker?.pushManager.getSubscription();
    if (!existing) return null;
    const endpoint = existing.endpoint;
    await existing.unsubscribe();
    return endpoint;
  } catch {
    return null;
  }
}

/** What a feature answers the worker for the tags it owns. */
export interface WebPushTabHandler {
  /** Whether this tab, visible and focused, shows what the tag is about. */
  shows(tag: string): boolean;
  /** Opens what the clicked notification is about; false when this tab cannot. */
  open(input: { tag: string; url: string }): boolean;
}

const handlers = new Set<WebPushTabHandler>();
let listening = false;

function answer(event: MessageEvent): void {
  const data = event.data as { type?: unknown; tag?: unknown; url?: unknown } | null;
  const port = event.ports[0];
  if (!port || typeof data?.tag !== "string") return;
  const tag = data.tag;
  let handled = false;
  if (data.type === PUSH_SHOWS_MESSAGE) {
    handled = [...handlers].some((handler) => handler.shows(tag));
  } else if (data.type === PUSH_OPEN_MESSAGE && typeof data.url === "string") {
    const url = data.url;
    handled = [...handlers].some((handler) => handler.open({ tag, url }));
  } else {
    return;
  }
  port.postMessage({ handled });
}

/** Answers the worker for one feature's tags while the returned cleanup has not run. */
export function listenToWebPushWorker(handler: WebPushTabHandler): () => void {
  handlers.add(handler);
  if (!listening && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", answer);
    listening = true;
  }
  return () => {
    handlers.delete(handler);
  };
}
