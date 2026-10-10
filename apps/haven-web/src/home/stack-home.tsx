import {
  Button,
  Callout,
  Code,
  ConfirmButton,
  Grid,
  Page,
  StatusDot,
  Tabs,
  Text,
} from "@langwatch/design-system-internal";
import { Suspense, lazy, useState } from "react";

import type { Navigate } from "../hub/hub-app.tsx";
import {
  START_PATH,
  resetDatabasesPath,
  restartPath,
  seedPath,
  startServicePath,
} from "../shared/api.ts";
import type { StackHome as StackHomeData, Surface } from "../shared/contract.ts";
import { HavenTopBar } from "../shared/haven-top-bar.tsx";
import { tabPath } from "../shared/route.ts";
import { useLifecycle } from "../shared/use-lifecycle.ts";
import { FactsPanel } from "./facts-panel.tsx";
import { JobsPanel } from "./jobs-panel.tsx";
import { RecentErrors } from "./recent-errors.tsx";
import { ResetDialog } from "./reset-dialog.tsx";
import { StoresPanel } from "./stores-panel.tsx";
import { SurfacesPanel } from "./surfaces-panel.tsx";

const StackState = ({ home }: { home: StackHomeData }) => {
  if (home.live) return <StatusDot state="live" label="Running" />;
  if (home.registered) return <StatusDot state="down" label="Launcher gone" />;
  return <StatusDot state="down" label="Stopped" />;
};

// Each tab beyond the overview is its own chunk: only the opened one downloads.
const SimsTab = lazy(() => import("./sims/sims-tab.tsx").then((m) => ({ default: m.SimsTab })));
const OrbTab = lazy(() => import("./orb/orb-tab.tsx").then((m) => ({ default: m.OrbTab })));
const BrowserTab = lazy(() =>
  import("./browser/browser-tab.tsx").then((m) => ({ default: m.BrowserTab })),
);
const ObsTab = lazy(() => import("./obs/obs-tab.tsx").then((m) => ({ default: m.ObsTab })));
const DbTab = lazy(() => import("./db/db-tab.tsx").then((m) => ({ default: m.DbTab })));
const LogsTab = lazy(() => import("./logs/logs-tab.tsx").then((m) => ({ default: m.LogsTab })));

/** The tabs mirror haven's CLI groups (ADR-064 amendment 2026-10-10). */
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "logs", label: "Logs & errors" },
  { id: "sims", label: "Sims" },
  { id: "browser", label: "Browser" },
  { id: "orb", label: "Orb" },
  { id: "obs", label: "Obs" },
  { id: "db", label: "DB" },
];

const tabOf = ({ tab }: { tab: string }) =>
  TABS.some((item) => item.id === tab) ? tab : "overview";

export type StackHomeProps = {
  home: StackHomeData;
  /** Epoch milliseconds the ages are measured from. */
  now: number;
  refresh: () => Promise<void>;
  /** The last poll's failure: the page shows what the daemon said before it. */
  stale?: string;
  /** The path's tab and sub-tab; an unknown tab is the overview. */
  tab: string;
  sub: string;
  navigate: Navigate;
};

export const StackHome = ({ home, now, refresh, stale, tab, sub, navigate }: StackHomeProps) => {
  const current = tabOf({ tab });
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
  const seed = ({ size, persona }: { size: string; persona: string }) =>
    void act({
      key: "seed",
      path: seedPath({ slug: home.slug }),
      body: { size, persona },
      doing: `seed ${home.slug}`,
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
      <Tabs
        label="Stack console"
        tabs={TABS}
        value={current}
        onChange={(id) => navigate({ path: tabPath({ tab: id }) })}
      />
      {current === "overview" && (
        <>
          <SurfacesPanel
            surfaces={home.surfaces}
            busy={busy}
            onRestart={home.actions.canRestart ? restartSurface : undefined}
            onStart={home.actions.canStartService ? startSurface : undefined}
          />
          <Grid columns={2}>
            <FactsPanel facts={home.facts} now={now} />
            <StoresPanel slug={home.slug} />
          </Grid>
          <JobsPanel slug={home.slug} now={now} />
          <RecentErrors errors={home.errors} />
        </>
      )}
      <Suspense fallback={<Text tone="muted">Loading…</Text>}>
        {current === "logs" && (
          <LogsTab
            slug={home.slug}
            sub={sub}
            now={now}
            onSub={(next) => navigate({ path: tabPath({ tab: "logs", sub: next }) })}
          />
        )}
        {current === "browser" && (
          <BrowserTab
            slug={home.slug}
            sub={sub}
            onSub={(next) => navigate({ path: tabPath({ tab: "browser", sub: next }) })}
          />
        )}
        {current === "orb" && (
          <OrbTab
            slug={home.slug}
            sub={sub}
            now={now}
            onSub={(next) => navigate({ path: tabPath({ tab: "orb", sub: next }) })}
          />
        )}
        {current === "obs" && (
          <ObsTab
            slug={home.slug}
            sub={sub}
            now={now}
            onSub={(next) => navigate({ path: tabPath({ tab: "obs", sub: next }) })}
          />
        )}
        {current === "db" && <DbTab home={home} seeding={busy === "seed"} onSeed={seed} />}
        {current === "sims" && (
          <SimsTab
            slug={home.slug}
            sub={sub}
            onSub={(next) => navigate({ path: tabPath({ tab: "sims", sub: next }) })}
          />
        )}
      </Suspense>
    </Page>
  );
};
