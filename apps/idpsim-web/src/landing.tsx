import {
  Badge,
  Button,
  Callout,
  Grid,
  Input,
  Inline,
  KeyValue,
  Link,
  Panel,
  Section,
  Stack,
  Table,
  Text,
  type KeyValueItem,
  type TableColumn,
} from "@langwatch/design-system-internal";
import { SimConsole } from "@langwatch/sim-console";
import { useState } from "react";

import { indexSchema, type TenantSummary } from "./api.ts";
import { answerStatus, useAnswer } from "./use-answer.ts";

const STEPS = [
  {
    title: "Pick a provider",
    body: "Any of them. They differ only in the domain they own and the people in their directory.",
  },
  {
    title: "Register your application",
    body: "Paste in the redirect address LangWatch showed you; the tenant hands back an issuer, a client id and a secret.",
  },
  {
    title: "Sign in from LangWatch",
    body: "The tenant's activity shows what it was asked for and what it answered, including the refusals.",
  },
];

export const CONTROL_API = [
  { request: "GET /control/state", does: "Every tenant, user and registered application as JSON" },
  { request: "POST /control/t/{n}/reset", does: "Puts one tenant back the way it started" },
  { request: "POST /control/t/{n}/users", does: "Adds a person to the tenant's directory" },
  {
    request: "POST /control/t/{n}/apps",
    does: "Registers an application and returns its credentials",
  },
  {
    request: "POST /control/t/{n}/config",
    does: "Changes how the tenant answers: claims, subject format",
  },
  {
    request: "PUT /control/t/{n}/scim-target",
    does: "Points the tenant at a directory to provision into",
  },
  { request: "POST /control/t/{n}/scim-push", does: "Sends the tenant's directory to that target" },
  { request: "POST /control/t/{n}/scim-pull", does: "Reads the target's directory back" },
  { request: "POST /control/t/{n}/population", does: "Generates a directory of a given size" },
  { request: "POST /control/t/{n}/churn", does: "Puts that directory through a round of change" },
  { request: "POST /control/t/{n}/scim-sync", does: "Sends only what changed since the last sync" },
  {
    request: "GET /control/t/{n}/activity",
    does: "What the tenant has been asked and what it answered",
  },
  { request: "PUT /control/dns/txt", does: "Publishes a TXT record this machine will answer for" },
  {
    request: "PUT /control/verification",
    does: "Publishes a domain proof on both DNS and HTTP at once",
  },
];

type ControlRow = (typeof CONTROL_API)[number];

const controlColumns: TableColumn<ControlRow>[] = [
  { key: "request", header: "Request", cell: (row) => row.request, mono: true, width: "40%" },
  { key: "does", header: "What it does", cell: (row) => row.does },
];

const tenantHref = ({ id }: { id: number }) => `/t/${id}/`;

const tenantColumns: TableColumn<TenantSummary>[] = [
  {
    key: "tenant",
    header: "Provider",
    cell: (row) => <Link href={tenantHref({ id: row.id })}>{`Tenant ${row.id}`}</Link>,
    width: "140px",
  },
  { key: "domain", header: "Domain", cell: (row) => row.domain, mono: true },
  {
    key: "users",
    header: "Users",
    cell: (row) => row.users.toLocaleString(),
    align: "end",
    width: "96px",
    hideOnNarrow: true,
  },
  {
    key: "registered",
    header: "Applications",
    // Only a tenant already set up is marked: it is the one being come back to.
    cell: (row) =>
      row.applications > 0 ? (
        <Badge tone="brand">{`${row.applications} registered`}</Badge>
      ) : (
        <Text tone="muted">none</Text>
      ),
    width: "150px",
  },
];

/** Tenants whose number or domain contains what was typed. */
export const matchTenants = ({ tenants, needle }: { tenants: TenantSummary[]; needle: string }) => {
  const wanted = needle.trim().toLowerCase();
  if (wanted === "") return tenants;
  return tenants.filter((tenant) =>
    `tenant ${tenant.id} ${tenant.domain}`.toLowerCase().includes(wanted),
  );
};

export const Landing = () => {
  const { data, refusal } = useAnswer({ path: "/api/tenants", schema: indexSchema });
  const [needle, setNeedle] = useState("");
  const [showControl, setShowControl] = useState(false);
  const tenants = data === undefined ? [] : matchTenants({ tenants: data.tenants, needle });

  const machine: KeyValueItem[] =
    data === undefined
      ? []
      : [
          { label: "Providers", value: String(data.tenants.length), copy: false },
          { label: "Base address", value: data.baseUrl },
          ...(data.dnsAddr === ""
            ? []
            : [{ label: "Verification DNS, over UDP", value: data.dnsAddr }]),
        ];

  return (
    <SimConsole
      sim="idp"
      title="IdP simulator"
      tabs={[]}
      activeTab=""
      onTab={() => undefined}
      status={answerStatus({ loaded: data !== undefined, refused: refusal !== undefined })}
    >
      <Section
        title="Your identity playground"
        description="Simulated identity providers, each with its own users, signing keys and domain. None of them talks to the internet and none of them can be broken: reset a tenant and it comes back the way it started."
      >
        <Stack gap={8}>
          {refusal !== undefined && (
            <Callout tone="error" title={refusal.title}>
              {refusal.detail} {refusal.hint}
            </Callout>
          )}
          <Section title="How to use it">
            <Grid columns={3}>
              {STEPS.map((step, index) => (
                <Panel key={step.title} title={`${index + 1}. ${step.title}`}>
                  <Text tone="secondary">{step.body}</Text>
                </Panel>
              ))}
            </Grid>
          </Section>

          <Section title="This machine">
            <Panel>
              <KeyValue items={machine} />
            </Panel>
          </Section>

          <Section title="Providers">
            <Stack gap={4}>
              <Inline gap={3} wrap>
                <div className="idp-grow">
                  <Input
                    label="Find a provider"
                    hideLabel
                    type="search"
                    placeholder="Tenant number or domain"
                    autoComplete="off"
                    value={needle}
                    onChange={setNeedle}
                  />
                </div>
                <Text tone="muted">{`${tenants.length} providers`}</Text>
              </Inline>
              <Panel>
                <Table
                  columns={tenantColumns}
                  rows={tenants}
                  rowKey={(row) => String(row.id)}
                  caption="Simulated identity providers"
                  empty={data === undefined ? "Loading…" : "No providers match your search."}
                  onRowClick={(row) => window.location.assign(tenantHref({ id: row.id }))}
                />
              </Panel>
            </Stack>
          </Section>

          <Panel
            title="Control API"
            meta="drive every one of these from a script"
            actions={
              <Button size="sm" variant="ghost" onClick={() => setShowControl((open) => !open)}>
                {showControl ? "Hide requests" : "Show requests"}
              </Button>
            }
          >
            {showControl ? (
              <Table columns={controlColumns} rows={CONTROL_API} rowKey={(row) => row.request} />
            ) : (
              <Text tone="secondary">
                {`${CONTROL_API.length} requests, each the scriptable twin of something on these pages.`}
              </Text>
            )}
          </Panel>
        </Stack>
      </Section>
    </SimConsole>
  );
};
