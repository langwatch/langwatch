import { Page } from "@langwatch/design-system-internal";
import { useCallback, useEffect, useState } from "react";

import { getJson } from "../shared/api.ts";
import { hubSchema, type HubStack } from "../shared/contract.ts";
import { HavenTopBar } from "../shared/haven-top-bar.tsx";
import { LogsBrowser, type LogsBrowserProps } from "../shared/logs-browser.tsx";
import { logsPath, type Route } from "../shared/route.ts";
import { usePoll } from "../shared/use-poll.ts";
import { Overview } from "./overview.tsx";
import { SettingsPage } from "./settings-page.tsx";

export type HubRoute = Extract<Route, { kind: "hub" }>;
export type Navigate = (input: { path: string; replace?: boolean }) => void;

const POLL_MS = 3000;

type LogsPageProps = LogsBrowserProps & {
  stacks: string[];
  /** The machine's stacks, for the top bar's consoles. */
  hubStacks?: HubStack[];
};

const LogsPage = ({ hubStacks, ...browser }: LogsPageProps) => (
  <Page
    width="full"
    nav={<HavenTopBar current="logs" hubHref="/" stacks={hubStacks} />}
    title="Logs"
    subtitle="Captured output of every stack on this machine."
  >
    <LogsBrowser {...browser} />
  </Page>
);

const isTyping = ({ element }: { element: Element | null }) =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLSelectElement ||
  (element instanceof HTMLElement && element.isContentEditable);

/** `/` anywhere on the hub opens the log filter, unless something is being typed into. */
const useSlashShortcut = ({ onSlash }: { onSlash: () => void }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping({ element: document.activeElement })) return;
      event.preventDefault();
      onSlash();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onSlash]);
};

export const HubApp = ({ route, navigate }: { route: HubRoute; navigate: Navigate }) => {
  const poll = usePoll({
    key: "hub",
    intervalMs: POLL_MS,
    load: ({ signal }) => getJson({ path: "/api/hub", schema: hubSchema, signal }),
  });
  const [focusRequest, setFocusRequest] = useState(0);
  const onLogs = route.page === "logs";
  const onSlash = useCallback(() => {
    if (!onLogs) navigate({ path: logsPath({}) });
    setFocusRequest((previous) => previous + 1);
  }, [onLogs, navigate]);
  useSlashShortcut({ onSlash });

  if (route.page === "overview") return <Overview poll={poll} />;
  if (route.page === "settings") return <SettingsPage hubStacks={poll.data?.stacks} />;
  const stacks = (poll.data?.stacks ?? []).map((stack) => stack.slug);
  const [only] = stacks;
  const stack =
    route.stack === "" && stacks.length === 1 && only !== undefined ? only : route.stack;
  return (
    <LogsPage
      stacks={stacks}
      stack={stack}
      lane={route.lane}
      focusRequest={focusRequest}
      hubStacks={poll.data?.stacks}
      onSelect={(selection) => navigate({ path: logsPath(selection), replace: true })}
    />
  );
};
