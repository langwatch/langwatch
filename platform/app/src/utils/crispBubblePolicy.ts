import { useEffect } from "react";

/**
 * Single owner of the Crisp chat bubble's visibility.
 *
 * The bubble renders in the same bottom corner as the Langy launcher, so it
 * must never idle-show on its own: it becomes visible only through a
 * deliberate open (sidebar Chat button, command palette) or an incoming
 * operator message, and returns to hidden when the chat box is closed.
 *
 * Crisp's script re-shows the bubble on its own schedule (session restore,
 * tab visibility changes, its container re-mounting), so a single boot-time
 * "chat:hide" is not enough. Suppression is layered:
 *
 * - CSS backstop: index.html ships `<html data-crisp-suppressed>` and
 *   globals.scss keeps the Crisp container `display: none !important` while
 *   the attribute is present, so the bubble stays hidden before any script
 *   runs and regardless of what Crisp does to its own inline styles.
 * - "chat:hide" re-asserts: queued on install (drained the moment Crisp
 *   boots), and pushed again when Crisp becomes ready (CRISP_READY_TRIGGER),
 *   on visibilitychange, pageshow and focus, when the Crisp container is
 *   (re-)inserted into the DOM, and when the user closes the chat box.
 *
 * Every `$crisp` access is guarded: self-hosted builds and local dev never
 * load Crisp, and there the policy only maintains the (inert) attribute.
 */

const SUPPRESSED_ATTRIBUTE = "data-crisp-suppressed";
const CRISP_CONTAINER_SELECTOR = "#crisp-chatbox, .crisp-client";

type CrispQueue = { push: (args: unknown[]) => unknown };
type CrispWindow = {
  $crisp?: CrispQueue;
  CRISP_READY_TRIGGER?: () => void;
};

function crispWindow(): CrispWindow | undefined {
  if (typeof window === "undefined") return undefined;
  return window as unknown as CrispWindow;
}

function getCrisp(): CrispQueue | undefined {
  const crisp = crispWindow()?.$crisp;
  return typeof crisp?.push === "function" ? crisp : undefined;
}

let suppressed = true;
let teardown: (() => void) | undefined;

function applySuppressedAttribute(): void {
  if (typeof document === "undefined") return;
  document.documentElement.toggleAttribute(SUPPRESSED_ATTRIBUTE, suppressed);
}

function suppress(): void {
  suppressed = true;
  applySuppressedAttribute();
  getCrisp()?.push(["do", "chat:hide"]);
}

function liftSuppression(): void {
  suppressed = false;
  applySuppressedAttribute();
}

/**
 * Re-asserts the hidden state. A no-op while the chat is deliberately open,
 * so a defensive trigger (tab switch, focus) never closes an ongoing support
 * conversation.
 */
export function assertCrispChatHidden(): void {
  if (!suppressed) return;
  suppress();
}

/**
 * Deliberate open path (sidebar Chat button, command palette "Open chat"):
 * lifts suppression, then lets Crisp toggle the chat box. Closing the box
 * fires "chat:closed", which restores suppression.
 */
export function toggleSupportChat(): void {
  const crisp = getCrisp();
  if (!crisp) return;
  liftSuppression();
  crisp.push(["do", "chat:show"]);
  crisp.push(["do", "chat:toggle"]);
}

function isCrispContainer(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return (
    node.matches(CRISP_CONTAINER_SELECTOR) ||
    node.querySelector(CRISP_CONTAINER_SELECTOR) !== null
  );
}

/**
 * Installs the policy: seeds the `$crisp` queue so the hide command and the
 * event bindings are drained the moment Crisp boots, and wires the re-assert
 * triggers. Returns a teardown that restores the default (suppressed) state.
 * Single owner: mounted once, from ExtraFooterComponents.
 */
export function installCrispBubblePolicy(): () => void {
  if (teardown) return teardown;
  const w = crispWindow();
  if (!w) return () => undefined;

  // Pre-boot, $crisp is a plain array Crisp drains at boot; the loader
  // script preserves an existing queue (window.$crisp = window.$crisp || []),
  // so these pushes work whether Crisp is already live or not loaded yet.
  if (!w.$crisp) {
    w.$crisp = [] as unknown as CrispQueue;
  }
  const queue = w.$crisp;

  // The chat box can be opened by callers that push "chat:toggle" directly
  // (the command palette does): on the opened event the CSS backstop must
  // stand down so it never fights a deliberately open widget.
  queue.push(["on", "chat:opened", liftSuppression]);
  queue.push(["on", "chat:closed", suppress]);
  // An operator reply must never be silently hidden: lift suppression so
  // Crisp can surface the bubble with the unread message.
  queue.push(["on", "message:received", liftSuppression]);

  const previousReadyTrigger = w.CRISP_READY_TRIGGER;
  w.CRISP_READY_TRIGGER = () => {
    previousReadyTrigger?.();
    assertCrispChatHidden();
  };

  const reassert = () => assertCrispChatHidden();
  document.addEventListener("visibilitychange", reassert);
  window.addEventListener("pageshow", reassert);
  window.addEventListener("focus", reassert);

  // Fires exactly when Crisp (re-)inserts its container, covering late boot
  // and iframe re-mounts without polling.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (isCrispContainer(node)) {
          assertCrispChatHidden();
          return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true });

  suppress();

  teardown = () => {
    document.removeEventListener("visibilitychange", reassert);
    window.removeEventListener("pageshow", reassert);
    window.removeEventListener("focus", reassert);
    observer.disconnect();
    w.CRISP_READY_TRIGGER = previousReadyTrigger;
    const crisp = getCrisp();
    crisp?.push(["off", "chat:opened"]);
    crisp?.push(["off", "chat:closed"]);
    crisp?.push(["off", "message:received"]);
    teardown = undefined;
    suppress();
  };
  return teardown;
}

/**
 * Mounts the policy while Crisp can be present (SaaS). Self-hosted builds
 * never load Crisp, so the policy stays uninstalled there and the baked
 * `data-crisp-suppressed` attribute simply matches nothing.
 */
export function useCrispBubblePolicy({ enabled }: { enabled: boolean }): void {
  useEffect(() => {
    if (!enabled) return;
    return installCrispBubblePolicy();
  }, [enabled]);
}
