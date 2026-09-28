import "../src/styles.css";
import "./gallery.css";
import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Code,
  CodeBlock,
  ConfirmButton,
  CopyButton,
  Dialog,
  EmptyState,
  Grid,
  IconButton,
  IconMore,
  IconRefresh,
  initTheme,
  Inline,
  Input,
  KeyValue,
  Link,
  List,
  ListItem,
  LogView,
  Menu,
  Meter,
  Page,
  Panel,
  Section,
  SegmentedControl,
  Select,
  Spacer,
  Stack,
  StatusDot,
  Table,
  Tabs,
  Text,
  Textarea,
  Toast,
  ToastProvider,
  TopBar,
  useToast,
  type LogLine,
  type StatusState,
  type TableColumn,
} from "../src/index.ts";

const slug = "feat-strict-feature-layout-v0";

type Service = { name: string; state: StatusState; host: string; port: number; memory: string };

const services: Service[] = [
  {
    name: "ui",
    state: "live",
    host: `app.${slug}.langwatch.localhost`,
    port: 5560,
    memory: "412 MB",
  },
  {
    name: "api",
    state: "live",
    host: `app.${slug}.langwatch.localhost/api`,
    port: 6560,
    memory: "688 MB",
  },
  { name: "worker", state: "starting", host: "no public host", port: 6561, memory: "301 MB" },
  {
    name: "aigateway",
    state: "down",
    host: `gateway.${slug}.langwatch.localhost`,
    port: 5563,
    memory: "0 MB",
  },
  {
    name: "langevals",
    state: "unknown",
    host: `evals.${slug}.langwatch.localhost`,
    port: 5564,
    memory: "n/a",
  },
];

const serviceColumns: TableColumn<Service>[] = [
  { key: "name", header: "Service", cell: (row) => row.name },
  {
    key: "state",
    header: "State",
    cell: (row) => <StatusDot state={row.state} />,
    width: "120px",
  },
  {
    key: "host",
    header: "Host",
    cell: (row) => row.host,
    mono: true,
    muted: true,
    hideOnNarrow: true,
  },
  {
    key: "port",
    header: "Port",
    cell: (row) => row.port,
    mono: true,
    align: "end",
    width: "72px",
  },
  {
    key: "actions",
    header: <span className="ds-visually-hidden">Actions</span>,
    cell: (row) => <IconButton label={`More for ${row.name}`} icon={<IconMore />} size="sm" />,
    width: "60px",
    align: "end",
  },
];

const logLines: LogLine[] = [
  { time: "19:02:11", level: "info", text: "api listening on :6560" },
  { time: "19:02:11", level: "debug", text: "resolved 14 modules from the catalogue" },
  { time: "19:02:12", level: "warn", text: "redis: slow reply (412 ms) on BRPOPLPUSH" },
  {
    time: "19:02:13",
    level: "error",
    text: "aigateway: dial tcp 127.0.0.1:5563: connect: connection refused",
  },
  {
    time: "19:02:14",
    level: "info",
    text: `GET /api/traces?projectId=project_8e2b6a&from=2026-09-28T00:00:00Z&to=2026-09-28T23:59:59Z&pageSize=100&sort=timestamp_desc 200 38ms (a long line wraps rather than widening the page)`,
  },
  {
    time: "19:02:15",
    level: "info",
    text: "worker drained 32 jobs from experiment-run-processing",
  },
];

const Case = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => (
  <div data-screen={id}>
    <Section title={title}>{children}</Section>
  </div>
);

const TypeCase = () => (
  <Case id="type" title="Type, code and links">
    <Stack gap={3}>
      <Text size="lg" weight="semibold">
        Sixteen, semibold: a panel lead
      </Text>
      <Text>
        Body text at 14px in ink-900. A hostname reads <Code>app.{slug}.langwatch.localhost</Code>{" "}
        inline, and a number sits in tabular figures: 1,204 of 16,384.
      </Text>
      <Text tone="secondary">Secondary text in ink-600, the lightest body text may go.</Text>
      <Text size="sm" tone="muted">
        Small muted meta: last seen 4 minutes ago
      </Text>
      <Inline gap={4} wrap>
        <Link href="#type">An internal link</Link>
        <Link href="https://langwatch.ai" external>
          An external link
        </Link>
        <Link href="#type" mono>
          mail.{slug}.langwatch.localhost
        </Link>
      </Inline>
      <div className="gallery-narrow">
        <Text mono truncate>
          /Users/someone/Source/github.com/langwatch/langwatch/.worktrees/{slug}/apps/haven-web
        </Text>
      </div>
    </Stack>
  </Case>
);

const StatusCase = () => (
  <Case id="status" title="Status, badges and meters">
    <Stack gap={4}>
      <Inline gap={5} wrap>
        <StatusDot state="live" />
        <StatusDot state="starting" />
        <StatusDot state="down" />
        <StatusDot state="unknown" />
      </Inline>
      <Inline gap={2} wrap>
        <Badge>Neutral</Badge>
        <Badge tone="brand">Baseline</Badge>
        <Badge tone="ok">Live</Badge>
        <Badge tone="warn">Stale</Badge>
        <Badge tone="error">Down</Badge>
        <Badge mono>:5560</Badge>
      </Inline>
      <Grid columns={3} gap={6}>
        <Meter label="Memory" value={6.2} max={16} detail="6.2 of 16 GB" />
        <Meter label="Disk" value={412} max={512} detail="412 of 512 GB" />
        <Meter label="Swap" value={3.9} max={4} detail="3.9 of 4 GB" />
      </Grid>
    </Stack>
  </Case>
);

const ButtonsCase = () => {
  const [size, setSize] = useState<"all" | "live">("all");
  const [service, setService] = useState("api");
  return (
    <Case id="buttons" title="Buttons and a mixed row">
      <Stack gap={4}>
        <Inline gap={2} wrap>
          <Button variant="primary">Start stack</Button>
          <Button>Restart</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Destroy</Button>
          <Button icon={<IconRefresh />}>Refresh</Button>
          <IconButton label="Refresh" icon={<IconRefresh />} variant="secondary" />
          <IconButton label="More" icon={<IconMore />} />
        </Inline>
        <Inline gap={2} wrap>
          <Button variant="primary" size="sm">
            Open
          </Button>
          <Button size="sm">Logs</Button>
          <Button variant="ghost" size="sm">
            Hide
          </Button>
          <Button variant="primary" loading>
            Starting
          </Button>
          <Button disabled>Disabled</Button>
          <CopyButton value="haven up" label="Copy command" showLabel />
          <ConfirmButton label="Stop" onConfirm={() => undefined} />
        </Inline>
        <Inline gap={2} wrap>
          <Input label="Filter" hideLabel placeholder="Filter services" />
          <Select
            label="Service"
            hideLabel
            value={service}
            onChange={setService}
            options={[
              { value: "api", label: "api" },
              { value: "worker", label: "worker" },
            ]}
          />
          <SegmentedControl
            label="Show"
            value={size}
            onChange={setSize}
            options={[
              { value: "all", label: "All" },
              { value: "live", label: "Live" },
            ]}
          />
          <Button variant="primary">Apply</Button>
          <IconButton label="More" icon={<IconMore />} variant="secondary" />
        </Inline>
      </Stack>
    </Case>
  );
};

const FormsCase = () => {
  const [tab, setTab] = useState("services");
  const [checked, setChecked] = useState(true);
  const [mode, setMode] = useState<"inbox" | "raw" | "html">("inbox");
  return (
    <Case id="forms" title="Fields, choices and tabs">
      <Stack gap={5}>
        <Tabs
          label="Stack views"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "services", label: "Services", count: 5 },
            { id: "logs", label: "Logs" },
            { id: "mail", label: "Mail", count: 12 },
            { id: "settings", label: "Settings" },
          ]}
        />
        <Grid columns={2} gap={4}>
          <Input label="Email" placeholder="someone@example.com" hint="Any address signs in." />
          <Input label="Client id" mono defaultValue="langwatch-dev" />
          <Input label="Redirect URI" defaultValue="not a url" error="Enter an absolute URL." />
          <Input label="Issuer" defaultValue="http://idp.localhost" disabled />
        </Grid>
        <Textarea label="Claims" mono defaultValue={'{\n  "email": "someone@example.com"\n}'} />
        <Inline gap={6} wrap align="start">
          <Checkbox label="Follow the tail" checked={checked} onChange={setChecked} />
          <Checkbox
            label="Keep sent mail"
            description="Kept until the stack goes down."
            checked={!checked}
            onChange={(next) => setChecked(!next)}
          />
          <Checkbox label="Disabled" checked={false} onChange={() => undefined} disabled />
        </Inline>
        <Inline gap={3} wrap>
          <SegmentedControl
            label="View"
            value={mode}
            onChange={setMode}
            options={[
              { value: "inbox", label: "Inbox" },
              { value: "raw", label: "Raw" },
              { value: "html", label: "HTML" },
            ]}
          />
          <SegmentedControl
            label="View, small"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: "inbox", label: "Inbox" },
              { value: "raw", label: "Raw" },
              { value: "html", label: "HTML" },
            ]}
          />
        </Inline>
      </Stack>
    </Case>
  );
};

const PanelsCase = () => (
  <Case id="panels" title="Panels">
    <Stack gap={4}>
      <Panel
        title="Services"
        meta="5 services, 2 live"
        actions={
          <>
            <Button size="sm">Logs</Button>
            <ConfirmButton size="sm" label="Restart" onConfirm={() => undefined} />
          </>
        }
      >
        <Table columns={serviceColumns} rows={services} rowKey={(row) => row.name} />
      </Panel>
      <Grid columns={2} gap={4}>
        <Panel title="Stack" meta={slug}>
          <KeyValue
            items={[
              { label: "Slug", value: slug },
              { label: "App", value: `app.${slug}.langwatch.localhost` },
              { label: "Database", value: "postgres://localhost:5433/langwatch_feat" },
              { label: "State", value: <StatusDot state="live" />, copy: false, mono: false },
            ]}
          />
        </Panel>
        <Panel title="Consoles">
          <List>
            <ListItem
              href="#panels"
              title="IdP simulator"
              description={`idp.${slug}.langwatch.localhost`}
              meta={<StatusDot state="live" />}
            />
            <ListItem
              title="Mail sink"
              description={`mail.${slug}.langwatch.localhost`}
              actions={<Button size="sm">Start</Button>}
            />
            <ListItem title="Storybook" description="Not started" meta="idle" />
          </List>
        </Panel>
      </Grid>
      <Grid columns={2} gap={4}>
        <Panel title="Mail">
          <EmptyState
            title="No mail yet"
            description="Mail the stack sends lands here, nothing leaves the machine."
            action={<Button variant="primary">Send a test mail</Button>}
          />
        </Panel>
        <Panel title="Notes" meta="padded body">
          <Stack gap={2}>
            <Text>A panel's body is inset 16px, the same as its header and its rows.</Text>
            <Text tone="secondary">Stacked panels meet with a gap, never touching borders.</Text>
          </Stack>
        </Panel>
      </Grid>
    </Stack>
  </Case>
);

const TableCase = () => (
  <Case id="table" title="Tables on their own">
    <Stack gap={4}>
      <Table
        columns={serviceColumns}
        rows={services.slice(0, 3)}
        rowKey={(row) => row.name}
        onRowClick={() => undefined}
        caption="Services"
      />
      <Table
        columns={serviceColumns}
        rows={[]}
        rowKey={(row) => row.name}
        empty="No services yet."
      />
    </Stack>
  </Case>
);

const CodeCase = () => (
  <Case id="code" title="Code and logs">
    <Stack gap={4}>
      <CodeBlock label="Shell command" code="make haven up" />
      <CodeBlock
        label="Environment"
        code={`LANGWATCH_ENDPOINT=http://app.${slug}.langwatch.localhost/api\nNEXTAUTH_URL=http://app.${slug}.langwatch.localhost\nA_VERY_LONG_LINE_THAT_SCROLLS_SIDEWAYS_RATHER_THAN_WRAPPING=${"x".repeat(80)}`}
      />
      <Panel
        title="api"
        meta="following"
        actions={
          <CopyButton value={logLines.map((line) => line.text).join("\n")} label="Copy log" />
        }
      >
        <LogView lines={logLines} height="sm" />
      </Panel>
    </Stack>
  </Case>
);

const CalloutCase = () => (
  <Case id="callouts" title="Callouts">
    <Stack gap={3}>
      <Callout title="The worker runs with the stack">
        ui, api and worker always start together; a stack without the worker processes nothing.
      </Callout>
      <Callout tone="warning" title="Memory pressure">
        This machine is at 91% memory. Stop a stack you are not using.
      </Callout>
      <Callout tone="error" title="aigateway is down">
        It exited with status 2. Read its log for the reason.
      </Callout>
    </Stack>
  </Case>
);

const OverlaysCase = () => {
  const [open, setOpen] = useState(false);
  const toaster = useToast();
  return (
    <Case id="overlays" title="Menus, dialogs and toasts">
      <Stack gap={4}>
        <Inline gap={2} wrap>
          <Button onClick={() => setOpen(true)}>Open dialog</Button>
          <Button onClick={() => toaster.show({ title: "Stack restarted", tone: "ok" })}>
            Show toast
          </Button>
          <Menu
            label="Actions"
            items={[
              { label: "Restart", onSelect: () => undefined },
              { label: "Open logs", onSelect: () => undefined },
              { label: "Disabled", onSelect: () => undefined, disabled: true },
              { label: "Destroy", onSelect: () => undefined, tone: "danger" },
            ]}
          />
          <Spacer />
          <Menu
            label="More"
            iconOnly
            align="end"
            items={[{ label: "Copy slug", onSelect: () => undefined }]}
          />
        </Inline>
        <div className="gallery-menu-room">
          <Menu
            label="Open menu"
            defaultOpen
            items={[
              { label: "Restart", onSelect: () => undefined },
              { label: "Open logs", onSelect: () => undefined },
              { label: "Disabled", onSelect: () => undefined, disabled: true },
              { label: "Destroy", onSelect: () => undefined, tone: "danger" },
            ]}
          />
        </div>
        <Stack gap={2}>
          <Toast title="Copied the hostname" />
          <Toast
            title="Stack restarted"
            description="All 5 services are live."
            tone="ok"
            onDismiss={() => undefined}
          />
          <Toast title="Mail sink is slow" tone="warning" onDismiss={() => undefined} />
          <Toast
            title="Restart failed"
            description="api exited with status 1."
            tone="error"
            onDismiss={() => undefined}
          />
        </Stack>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Destroy this stack?"
          description={`Stops every service of ${slug} and deletes its databases.`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => setOpen(false)}>
                Destroy
              </Button>
            </>
          }
        >
          <Callout tone="warning">This cannot be undone.</Callout>
        </Dialog>
      </Stack>
    </Case>
  );
};

const TopBarCase = () => (
  <Case id="topbar" title="Top bar">
    <div className="gallery-frame">
      <TopBar
        name="haven"
        slug={slug}
        homeHref="#topbar"
        links={[
          { label: "Stack", href: "#topbar", current: true },
          { label: "IdP", href: "#topbar" },
          { label: "Mail", href: "#topbar" },
          { label: "Mail room", href: "#topbar" },
          { label: "Storybook", href: "#topbar" },
        ]}
      />
    </div>
  </Case>
);

const Cases = () => (
  <>
    <TopBarCase />
    <TypeCase />
    <StatusCase />
    <ButtonsCase />
    <FormsCase />
    <PanelsCase />
    <TableCase />
    <CodeCase />
    <CalloutCase />
    <OverlaysCase />
  </>
);

const single = new URLSearchParams(window.location.search).get("pane") === "single";

const Gallery = () => (
  <Page
    nav={
      <TopBar name="Internal design kit" links={[{ label: "Gallery", href: "/", current: true }]} />
    }
    title="Every component, every state"
    subtitle={
      single
        ? "One pane, following the page theme."
        : "Light and dark side by side; add ?pane=single for one pane that follows the page theme."
    }
    width={single ? "default" : "full"}
    actions={
      <Button variant="primary" href={single ? "/" : "/?pane=single"}>
        {single ? "Side by side" : "One pane"}
      </Button>
    }
  >
    {single ? (
      <Cases />
    ) : (
      <div className="gallery-panes">
        <div className="gallery-pane" data-theme="light">
          <Cases />
        </div>
        <div className="gallery-pane" data-theme="dark">
          <Cases />
        </div>
      </div>
    )}
  </Page>
);

initTheme();
const root = document.getElementById("gallery");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ToastProvider>
        <Gallery />
      </ToastProvider>
    </StrictMode>,
  );
}
