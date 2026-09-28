import { Button, Callout, EmptyState, Page, Panel } from "@langwatch/design-system-internal";

import { getStackHome } from "../shared/api.ts";
import { nowMs } from "../shared/clock.ts";
import { Connection } from "../shared/connection.tsx";
import { HavenTopBar } from "../shared/haven-top-bar.tsx";
import { hubUrlBeside } from "../shared/route.ts";
import { usePoll } from "../shared/use-poll.ts";
import { StackHome } from "./stack-home.tsx";

const POLL_MS = 3000;

/** `<slug>.langwatch.localhost`: one worktree's page, read from `/api/stacks/<slug>`. */
export const StackHomeApp = ({ slug }: { slug: string }) => {
  const poll = usePoll({
    key: slug,
    intervalMs: POLL_MS,
    load: ({ signal }) => getStackHome({ slug, signal }),
  });
  const answer = poll.data;
  if (answer?.found === true) {
    return (
      <StackHome
        home={answer.home}
        now={poll.updatedAt ?? nowMs()}
        refresh={poll.refresh}
        stale={poll.error}
      />
    );
  }

  const hubHref = answer?.notFound.hubUrl ?? hubUrlBeside({ location: window.location });
  const nav = <HavenTopBar current="home" hubHref={hubHref} />;
  if (answer?.found === false) {
    return (
      <Page nav={nav}>
        <Panel>
          <EmptyState
            title={`No stack is registered for “${answer.notFound.slug}”`}
            description="Bring it up with haven up in its worktree, or pick a stack from the hub."
            action={
              <Button variant="primary" href={hubHref}>
                Open the hub
              </Button>
            }
          />
        </Panel>
      </Page>
    );
  }
  return (
    <Page
      nav={nav}
      title={slug}
      subtitle="Reading the stack…"
      actions={<Connection error={poll.error} updatedAt={poll.updatedAt} />}
    >
      {poll.error !== undefined && (
        <Callout tone="error" title="The haven daemon is not answering">
          {poll.error}
        </Callout>
      )}
    </Page>
  );
};
