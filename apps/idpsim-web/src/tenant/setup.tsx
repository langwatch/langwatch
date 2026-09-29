import {
  Button,
  Code,
  ConfirmButton,
  CopyButton,
  Grid,
  Inline,
  Input,
  KeyValue,
  Link,
  Panel,
  Section,
  Stack,
  Table,
  Text,
  Textarea,
  type TableColumn,
} from "@langwatch/design-system-internal";
import { useState, type FormEvent } from "react";

import {
  applicationSchema,
  emptySchema,
  tenantPath,
  type Application,
  type TenantView,
} from "../api.ts";
import { RefusalCallout } from "../refusal-callout.tsx";
import { useAct } from "../use-act.ts";

/** A value truncated to one line, with the whole of it on hover and the clipboard. */
const Copyable = ({ value, label }: { value: string; label: string }) => (
  <Inline gap={2} align="center" className="idp-copyable">
    <Text mono truncate title={value}>
      {value}
    </Text>
    <CopyButton value={value} label={`Copy ${label}`} />
  </Inline>
);

const RegisterPanel = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => {
  const { act, busy, refusal } = useAct({ onDone: reload });
  const [name, setName] = useState("");
  const [redirects, setRedirects] = useState("");
  const [entityId, setEntityId] = useState("");
  const [acsUrl, setAcsUrl] = useState("");
  const [registered, setRegistered] = useState<Application | undefined>(undefined);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const app = await act({
      name: "register",
      path: `${tenantPath({ id: tenant.id })}/apps`,
      method: "POST",
      body: { name, redirectUris: redirects.split("\n"), entityId, acsUrl },
      schema: applicationSchema,
    });
    if (app === undefined) return;
    setRegistered(app);
    setName("");
    setRedirects("");
    setEntityId("");
    setAcsUrl("");
  };

  return (
    <Stack gap={4}>
      {registered !== undefined && (
        <Panel title={`${registered.name} is registered`} meta="paste these into LangWatch">
          <KeyValue
            items={[
              { label: "Issuer address", value: tenant.baseUrl },
              { label: "Client id", value: registered.clientId },
              { label: "Client secret", value: registered.clientSecret },
            ]}
          />
        </Panel>
      )}
      <Panel title="Register an application">
        <form onSubmit={(event) => void submit(event)}>
          <Stack gap={4}>
            <Text tone="secondary">
              Give this tenant the redirect address LangWatch showed you, and it hands back the
              issuer, client id and client secret to paste into the wizard.
            </Text>
            <Input label="Name" placeholder="LangWatch" required value={name} onChange={setName} />
            <Textarea
              label="Redirect addresses"
              hint="One per line. Paste the address LangWatch shows before a connection exists exactly as written: a {connection} segment matches whatever real id turns up."
              placeholder="https://app.example.langwatch.localhost/api/auth/sso/callback/{connection}"
              mono
              rows={3}
              value={redirects}
              onChange={setRedirects}
            />
            <Grid columns={2}>
              <Input
                label="Service provider entity id"
                hint="Optional, for SAML"
                placeholder="https://app.example.langwatch.localhost/api/auth/sso/saml2/sp"
                mono
                value={entityId}
                onChange={setEntityId}
              />
              <Input
                label="Assertion consumer address"
                hint="Optional, for SAML"
                placeholder="https://app.example.langwatch.localhost/api/auth/sso/saml2/sp/acs/{connection}"
                mono
                value={acsUrl}
                onChange={setAcsUrl}
              />
            </Grid>
            <RefusalCallout refusal={refusal} />
            <div>
              <Button variant="primary" type="submit" loading={busy === "register"}>
                Register
              </Button>
            </div>
          </Stack>
        </form>
      </Panel>
    </Stack>
  );
};

const ApplicationsPanel = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => {
  const { act, refusal } = useAct({ onDone: reload });
  const remove = (app: Application) =>
    void act({
      name: `remove-${app.clientId}`,
      path: `${tenantPath({ id: tenant.id })}/apps/${encodeURIComponent(app.clientId)}`,
      method: "DELETE",
      schema: emptySchema,
    });
  const columns: TableColumn<Application>[] = [
    { key: "name", header: "Name", cell: (app) => app.name, width: "18%", hideOnNarrow: true },
    {
      key: "client",
      header: "Client id",
      cell: (app) => <Copyable value={app.clientId} label="client id" />,
    },
    {
      key: "secret",
      header: "Client secret",
      cell: (app) => <Copyable value={app.clientSecret} label="client secret" />,
      width: "22%",
      hideOnNarrow: true,
    },
    {
      key: "redirects",
      header: "Redirect addresses",
      cell: (app) =>
        [...app.redirectUris, ...(app.acsUrl ? [`SAML → ${app.acsUrl}`] : [])].join(", ") || "any",
      mono: true,
      muted: true,
      hideOnNarrow: true,
    },
    {
      key: "remove",
      header: "",
      cell: (app) => <ConfirmButton label="Remove" size="sm" onConfirm={() => remove(app)} />,
      align: "end",
      width: "112px",
    },
  ];
  return (
    <Section
      title="Registered applications"
      description="A registered client must present its secret and one of its redirect addresses. A client id this tenant does not know is still accepted with anything: that is the zero-setup path, and the activity says which of the two happened."
    >
      <Stack gap={4}>
        <RefusalCallout refusal={refusal} />
        <Panel>
          <Table
            columns={columns}
            rows={tenant.applications}
            rowKey={(app) => app.clientId}
            caption="Registered applications"
            empty="None yet: this tenant accepts any client id, secret and redirect address."
          />
        </Panel>
      </Stack>
    </Section>
  );
};

const certificateLines = ({ pem }: { pem: string }) => pem.trim().split("\n").length;

const ProtocolPanels = ({ tenant }: { tenant: TenantView }) => (
  <Section title="What to paste into LangWatch">
    <Stack gap={4}>
      <Grid columns={2}>
        <Stack gap={3}>
          <Panel title="OpenID Connect">
            <KeyValue
              items={[
                { label: "Issuer address", value: tenant.baseUrl },
                {
                  label: "Client id",
                  value:
                    tenant.applications.length > 0
                      ? "from a registered application"
                      : "any, or register one above",
                  mono: false,
                  copy: false,
                },
              ]}
            />
          </Panel>
          <Text tone="secondary" size="sm">
            LangWatch fetches{" "}
            <Link href={`${tenant.baseUrl}/.well-known/openid-configuration`} external>
              the discovery document
            </Link>{" "}
            when you save, so the issuer has to be reachable from wherever the app runs.
          </Text>
        </Stack>
        <Stack gap={3}>
          <Panel title="SAML">
            <KeyValue
              items={[
                { label: "Sign-in address", value: tenant.saml.signInUrl },
                { label: "Entity id", value: tenant.saml.entityId },
                {
                  label: "Signing certificate",
                  value: `PEM, ${certificateLines({ pem: tenant.saml.certificate })} lines`,
                  mono: false,
                  copy: tenant.saml.certificate,
                },
              ]}
            />
          </Panel>
          <Text tone="secondary" size="sm">
            Or give LangWatch{" "}
            <Link href={tenant.saml.metadataUrl} external>
              the metadata document
            </Link>{" "}
            instead of an entity id and certificate.
          </Text>
        </Stack>
      </Grid>
      <Stack gap={3}>
        <Panel title="Directory and domain">
          <KeyValue
            items={[
              { label: "SCIM base", value: `${tenant.baseUrl}/scim/v2` },
              { label: "SCIM token", value: tenant.scimToken },
              {
                label: "Domain proof",
                value: (
                  <>
                    a TXT record on <Code>{tenant.domain}</Code>
                    {tenant.dnsAddr === "" ? "" : ` answered on ${tenant.dnsAddr}`}, or the same
                    token under /.well-known/ over HTTP
                  </>
                ),
                mono: false,
              },
            ]}
          />
        </Panel>
        <Text tone="secondary" size="sm">
          That token guards this tenant's own directory, for provisioning into the simulator.
          Sending users the other way, as a real identity provider does, uses LangWatch's token on
          the Provisioning tab.
        </Text>
      </Stack>
    </Stack>
  </Section>
);

export const SetupTab = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => (
  <Stack gap={8}>
    <RegisterPanel tenant={tenant} reload={reload} />
    <ApplicationsPanel tenant={tenant} reload={reload} />
    <ProtocolPanels tenant={tenant} />
  </Stack>
);
