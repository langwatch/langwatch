import { useCallback, useRef, useState } from "react";

import type { Summary } from "./mail-api.ts";

const NOTIFY_KEY = "mailsim:notify";
const MAX_SINGLE_NOTIFICATIONS = 3;

const remembered = () => {
  try {
    return window.localStorage.getItem(NOTIFY_KEY) === "1";
  } catch {
    return false;
  }
};

const remember = ({ on }: { on: boolean }) => {
  try {
    window.localStorage.setItem(NOTIFY_KEY, on ? "1" : "0");
  } catch {
    // Storage refused: the toggle still holds for this session.
  }
};

/**
 * Desktop notifications, off until the toggle is pressed: a page that asks for
 * permission on load is one people deny for good. `announce` fires once per
 * message that arrived since the last list; the first list only records ids.
 */
export const useNotify = ({ onOpen }: { onOpen: (input: { id: string }) => void }) => {
  const supported = typeof window.Notification === "function";
  const [on, setOn] = useState(
    () => supported && remembered() && window.Notification.permission === "granted",
  );
  const known = useRef<Set<string> | undefined>(undefined);

  const toggle = useCallback(async () => {
    if (on) {
      setOn(false);
      remember({ on: false });
      return "Desktop notifications off.";
    }
    const permission =
      window.Notification.permission === "granted"
        ? "granted"
        : await window.Notification.requestPermission();
    if (permission !== "granted") {
      return "Your browser is blocking notifications for this site. Allow them in its site settings to turn this on.";
    }
    setOn(true);
    remember({ on: true });
    return "You will be told when a message arrives, even with this tab in the background.";
  }, [on]);

  const announce = useCallback(
    ({ messages }: { messages: Summary[] }) => {
      const ids = new Set(messages.map((message) => message.id));
      const previous = known.current;
      known.current = ids;
      if (previous === undefined || !on || window.Notification.permission !== "granted") return;
      const fresh = messages.filter((message) => !previous.has(message.id));
      for (const message of fresh.slice(0, MAX_SINGLE_NOTIFICATIONS)) {
        const note = new window.Notification(message.subject || "(no subject)", {
          body: `To ${message.to.join(", ")}`,
          tag: message.id,
        });
        note.addEventListener("click", () => {
          window.focus();
          onOpen({ id: message.id });
        });
      }
      if (fresh.length > MAX_SINGLE_NOTIFICATIONS) {
        new window.Notification(`${fresh.length} messages arrived`, { tag: "mailsim:batch" });
      }
    },
    [on, onOpen],
  );

  return { supported, on, toggle, announce };
};
