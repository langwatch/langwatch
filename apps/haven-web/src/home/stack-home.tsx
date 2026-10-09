import {
  Button,
  Callout,
  Code,
  ConfirmButton,
  Grid,
  Page,
  StatusDot,
} from "@langwatch/design-system-internal";
import { useState } from "react";

import { START_PATH, resetDatabasesPath, restartPath, startServicePath } from "../shared/api.ts";
import type { StackHome as StackHomeData, Surface } from "../shared/contract.ts";
import { HavenTopBar } from "../shared/haven-top-bar.tsx";
import { useLifecycle } from "../shared/use-lifecycle.ts";
import { CredentialsPanel } from "./credentials-panel.tsx";
import { FactsPanel } from "./facts-panel.tsx";
import { RecentErrors } from "./recent-errors.tsx";
import { ResetDialog } from "./reset-dialog.tsx";
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
  const [resetting, setResetting] = useState(false);
  const database = home.facts.databases.postgres.name;
  const app = home.surfaces.find((surface) => surface.name === "app");
  const restart = () =>
    void act({
      key: "restart",
      path: restartPath({ slug: home.slug }),
      doing: `restart ${home.slug}`,
    });
  const restartSurface = (surface: Surface) =>
    void act({
      key: surface.name,
      path: `${restartPath({ slug: home.slug })}?service=${encodeURIComponent(surface.restart)}`,
      doing: `restart ${surface.restart}`,
    });
  const startSurface = (surface: Surface) =>
    void act({
      key: surface.name,
      path: startServicePath({ slug: home.slug, service: surface.start }),
      doing: `start ${surface.start}`,
    });
  const resetDatabases = ({ database }: { database: string }) =>
    void act({
      key: "reset",
      path: resetDatabasesPath({ slug: home.slug }),
      body: { confirm: database },
      doing: `reset ${home.slug}'s databases`,
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
      {home.belowFloor !== "" && (
        <Callout
          tone="error"
          title="This stack's database is older than the supported upgrade floor"
        >
          {home.belowFloor}
          {home.actions.canResetDatabases && (
            <>
              {" "}
              <Button
                variant="danger"
                disabled={busy !== undefined}
                loading={busy === "reset"}
                onClick={() => setResetting(true)}
              >
                Reset databases
              </Button>
              <ResetDialog
                database={database}
                open={resetting}
                onClose={() => setResetting(false)}
                onConfirm={() => resetDatabases({ database })}
              />
            </>
          )}
        </Callout>
      )}
      <SurfacesPanel
        surfaces={home.surfaces}
        busy={busy}
        onRestart={home.actions.canRestart ? restartSurface : undefined}
        onStart={home.actions.canStartService ? startSurface : undefined}
      />
      <Grid columns={2}>
        <FactsPanel facts={home.facts} now={now} />
        <CredentialsPanel credentials={home.credentials} />
      </Grid>
      <RecentErrors errors={home.errors} />
    </Page>
  );
};
