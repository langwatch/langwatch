/**
 * The address, as the automations screen reads and writes it.
 *
 * It arrived using `~/utils/compat/next-router`'s `useRouter` (path parameters
 * and the query string merged into one `query` bag, plus `pathname`), which is
 * a router import a feature-web package may not make, so it is re-bound to the
 * host's route capability with the shape the call sites already expect.
 *
 * `push` and `replace` take the same strings the page passes today: an absolute
 * path navigates, and a bare `"?a=b"` rewrites the query of the current page.
 *
 * WHAT IS NOT HERE is the path. This family's four tabs are four URLs of one
 * screen, and `platform/app` decided which tab was showing by matching the
 * pathname. It does not have to: the route table gives each of the four
 * addresses its own PAGE KEY, and the frontend feature maps a key to a screen —
 * so the tab arrives as a prop and the screen never reads the address to learn
 * what it already was told.
 */

import { useMemo } from "react";
import { useAutomationHost } from "../model/automation-host";

export type AutomationRouter = {
  query: Readonly<Record<string, string | undefined>>;
  push: (to: string) => void;
  replace: (to: string) => void;
};

function queryOf(to: string): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {};
  new URLSearchParams(to.startsWith("?") ? to.slice(1) : to).forEach((value, key) => {
    next[key] = value;
  });
  return next;
}

export function useAutomationRouter(): AutomationRouter {
  const host = useAutomationHost();
  const reading = host.route();

  return useMemo(() => {
    const go = (to: string, replace: boolean) => {
      if (to.startsWith("?")) {
        host.setQuery(queryOf(to), { replace });
        return;
      }
      host.navigate(to);
    };
    return {
      // Path parameters first, then the query string, exactly as the compat
      // router merged them: a `?id=` that shadows a `:id` segment never wins.
      query: { ...reading.query, ...reading.params },
      push: (to: string) => go(to, false),
      replace: (to: string) => go(to, true),
    };
  }, [host, reading]);
}
