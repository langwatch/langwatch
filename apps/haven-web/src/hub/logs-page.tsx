import { Page } from "@langwatch/design-system-internal";

import type { HubStack } from "../shared/contract.ts";
import { HavenTopBar } from "../shared/haven-top-bar.tsx";
import { LogsBrowser, type LogsBrowserProps } from "../shared/logs-browser.tsx";

export type LogsPageProps = LogsBrowserProps & {
  stacks: string[];
  /** The machine's stacks, for the top bar's consoles. */
  hubStacks?: HubStack[];
};

export const LogsPage = ({ hubStacks, ...browser }: LogsPageProps) => (
  <Page
    width="full"
    nav={<HavenTopBar current="logs" hubHref="/" stacks={hubStacks} />}
    title="Logs"
    subtitle="Captured output of every stack on this machine."
  >
    <LogsBrowser {...browser} />
  </Page>
);
