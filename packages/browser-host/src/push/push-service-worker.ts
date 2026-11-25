/**
 * The Web Push service worker's handlers, over the worker APIs they use. A push is shown unless
 * a visible, focused tab shows it; a click focuses a tab or opens one.
 * Spec: specs/langy/langy-notifications.feature
 */

/** What a push carries, as notification's Web Push sends it. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/** Asked of a visible tab: does it show what this tag is about? */
export const PUSH_SHOWS_MESSAGE = "langwatch:push:shows";
/** Sent to a tab after a click: open what this tag is about. */
export const PUSH_OPEN_MESSAGE = "langwatch:push:open";

/** How long a tab has to answer before the worker decides without it. */
export const PUSH_CLIENT_ANSWER_MS = 750;

export interface PushWindowClient {
  readonly url: string;
  readonly focused: boolean;
  readonly visibilityState: string;
  postMessage(message: unknown, transfer: MessagePort[]): void;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
}

export interface PushWorkerScope {
  readonly origin: string;
  matchWindowClients(): Promise<readonly PushWindowClient[]>;
  openWindow(url: string): Promise<unknown>;
  showNotification(
    title: string,
    options: { body: string; tag: string; data: PushPayload },
  ): Promise<void>;
  createChannel(): { port1: MessagePort; port2: MessagePort };
}

/** The payload, or null when the push carries nothing this worker can show. */
export function readPushPayload(data: unknown): PushPayload | null {
  if (typeof data !== "object" || data === null) return null;
  const { title, body, url, tag } = data as Record<string, unknown>;
  if (typeof title !== "string" || title === "") return null;
  if (typeof url !== "string" || typeof tag !== "string") return null;
  return { title, body: typeof body === "string" ? body : "", url, tag };
}

/** The link, on this worker's own origin; anything else is replaced by the origin's root. */
export function sameOriginUrl(url: string, origin: string): string {
  try {
    const resolved = new URL(url, origin);
    return resolved.origin === origin ? resolved.href : `${origin}/`;
  } catch {
    return `${origin}/`;
  }
}

/** Sends one message to a tab and waits for its answer, or for the timeout. */
async function ask(
  scope: PushWorkerScope,
  client: PushWindowClient,
  message: Record<string, unknown>,
): Promise<boolean> {
  const { port1, port2 } = scope.createChannel();
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      port1.close();
      resolve(false);
    }, PUSH_CLIENT_ANSWER_MS);
    port1.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      port1.close();
      resolve((event.data as { handled?: unknown } | null)?.handled === true);
    };
    client.postMessage(message, [port2]);
  });
}

/** Shows the push, unless a visible, focused tab says it already shows what the push is about. */
export async function handlePush(scope: PushWorkerScope, data: unknown): Promise<void> {
  const payload = readPushPayload(data);
  if (!payload) return;
  const clients = await scope.matchWindowClients();
  const watching = clients.filter(
    (client) => client.focused && client.visibilityState === "visible",
  );
  for (const client of watching) {
    if (await ask(scope, client, { type: PUSH_SHOWS_MESSAGE, tag: payload.tag })) return;
  }
  await scope.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    data: payload,
  });
}

/**
 * Focuses a LangWatch tab and asks it to open the link; a tab that cannot is sent to the
 * link. With no tab open, a new one opens at the link.
 */
export async function handleNotificationClick(
  scope: PushWorkerScope,
  data: unknown,
): Promise<void> {
  const payload = readPushPayload(data);
  const url = sameOriginUrl(payload?.url ?? "/", scope.origin);
  const clients = await scope.matchWindowClients();
  const client =
    clients.find((candidate) => candidate.focused) ??
    clients.find((candidate) => candidate.visibilityState === "visible") ??
    clients[0];
  if (!client) {
    await scope.openWindow(url);
    return;
  }
  await client.focus();
  const handled = payload
    ? await ask(scope, client, { type: PUSH_OPEN_MESSAGE, tag: payload.tag, url })
    : false;
  if (handled) return;
  // A tab opened before the worker took control cannot be navigated by it.
  const navigated = await client.navigate?.(url).then(
    () => true,
    () => false,
  );
  if (!navigated) await scope.openWindow(url);
}
