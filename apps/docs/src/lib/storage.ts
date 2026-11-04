import { useEffect, useState } from "react";
import { z } from "zod/mini";

const PREFIX = "lw-docs:";
const EVENT = "lw-docs-pref";

export function readPreference({ key }: { key: string }): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writePreference({ key, value }: { key: string; value: string }) {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, value } }));
}

/** The stored value for `key`, null until hydration and when nothing is stored. */
export function usePreference({ key }: { key: string | null }): string | null {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    setValue(readPreference({ key }));
    const onChange = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const result = z.object({ key: z.string(), value: z.string() }).safeParse(event.detail);
      if (result.success && result.data.key === key) setValue(result.data.value);
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [key]);
  return value;
}
