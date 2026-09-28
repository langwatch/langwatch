import {
  Button,
  Callout,
  Code,
  ConfirmButton,
  Grid,
  Page,
  StatusDot,
} from "@langwatch/design-system-internal";

import { START_PATH, restartPath } from "../shared/api.ts";
import type { StackHome as StackHomeData } from "../shared/contract.ts";
import { HavenTopBar } from "../shared/haven-top-bar.tsx";
import { useLifecycle } from "../shared/use-lifecycle.ts";
import { CredentialsPanel } from "./credentials-panel.tsx";
import { FactsPanel } from "./facts-panel.tsx";
import { RecentErrors } from "./recent-errors.tsx";
import { SurfacesPanel } from "./surfaces-panel.tsx";

const StackState = ({ home }: { home: StackHomeData }) => {
  if (home.live) return <StatusDot state="live" label="Running" />;
  if (home.registered) return <StatusDot state="down" label="Launcher gone" />;
  return <StatusDot state="down" label="Stopped" />;
};

export type StackHomeProps = {
  home: StackHomeData;
  /** Epoch milliseconds the ages are measured from. */
  now: number;
  refresh: () => Promise<void>;
  /** The last poll's failure: the page shows what the daemon said before it. */
  stale?: string;
};

export const StackHome = ({ home, now, refresh, stale }: StackHomeProps) => {
  const { busy, act } = useLifecycle({ refresh });
  const app = home.surfaces.find((surface) => surface.name === "app");
  const restart = () =>
    void act({
      key: "restart",
      path: restartPath({ slug: home.slug }),
      doing: `restart ${home.slug}`,
    });
  const start = () =>
    void act({
      key: "start",
      path: START_PATH,
      body: { dir: home.actions.startDir },
      doing: `start ${home.slug}`,
    });
  return (
    <Page
      nav={
        <HavenTopBar
          current="home"
          hubHref={home.hubUrl}
          home={{ slug: home.slug, href: home.homeUrl || "/", surfaces: home.surfaces }}
        />
      }
      title={home.slug}
      subtitle={home.facts.branch || "No branch"}
      actions={
        <>
          <StackState home={home} />
          {home.actions.canRestart && (
            <ConfirmButton
              variant="secondary"
              label={busy === "restart" ? "Restarting" : "Restart"}
              confirmLabel="Restart?"
              disabled={busy !== undefined}
              onConfirm={restart}
            />
          )}
          {home.actions.canStart && (
            <Button variant="primary" loading={busy === "start"} onClick={start}>
              Start
            </Button>
          )}
          {home.live && app !== undefined && app.url !== "" && (
            <Button variant="primary" href={app.url}>
              Open app
            </Button>
          )}
        </>
      }
    >
      {stale !== undefined && (
        <Callout tone="error" title="The haven daemon stopped answering">
          This is what it said last. {stale}
        </Callout>
      )}
      {!home.registered && (
        <Callout title="This stack is not running">
          Its home answers anyway. Start it here, or run <Code>haven up</Code> in{" "}
          <Code>{home.facts.worktreeDir}</Code>.
        </Callout>
      )}
      <SurfacesPanel surfaces={home.surfaces} />
      <Grid columns={2}>
        <FactsPanel facts={home.facts} now={now} />
        <CredentialsPanel credentials={home.credentials} />
      </Grid>
      <RecentErrors errors={home.errors} />
    </Page>
  );
};
