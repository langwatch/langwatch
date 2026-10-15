import {
  Badge,
  Button,
  Inline,
  Input,
  KeyValue,
  Panel,
  Section,
  Select,
  Stack,
} from "@langwatch/design-system-internal";
import { SimEmpty, SimRefusal, SimTime } from "@langwatch/sim-console";
import { useState } from "react";

import { AuthorizeBanner } from "./authorize-banner.tsx";
import {
  connectModes,
  connectOAuth,
  forgetGrant,
  type ConnectMode,
  type Grant,
} from "./mcp-api.ts";
import type { ViewProps } from "./view-props.ts";

const modeOptions = connectModes.map((mode) => ({ value: mode, label: mode }));

const isMode = (value: string): value is ConnectMode => connectModes.some((mode) => mode === value);

const GrantPanel = ({ grant }: { grant: Grant }) => (
  <Panel
    title="OAuth grant"
    meta={
      <Badge tone={grant.connected ? "ok" : "neutral"}>
        {grant.connected ? "connected" : "not connected"}
      </Badge>
    }
  >
    {grant.connected ? (
      <KeyValue
        items={[
          { label: "Client id", value: grant.clientId ?? "none" },
          { label: "Project", value: grant.projectId || "none" },
          { label: "Access token", value: grant.accessHint ?? "none", copy: false },
          { label: "Refresh token", value: grant.refreshHint ?? "none", copy: false },
          {
            label: "Expires",
            value: grant.expiresAt ? <SimTime at={grant.expiresAt} /> : "unknown",
            copy: false,
          },
          { label: "Refreshes", value: String(grant.refreshes), copy: false },
        ]}
      />
    ) : (
      <SimEmpty
        title="No grant"
        hint="Connect OAuth to run the oauth flow scenarios against LangWatch."
      />
    )}
  </Panel>
);

/** Starts the OAuth connect: the sim approves itself (auto) or a person does (interactive). */
const ConnectPanel = ({
  autoApprove,
  defaultProject,
  connected,
  waiting,
  refresh,
}: {
  autoApprove?: string;
  defaultProject?: string;
  connected: boolean;
  waiting: boolean;
  refresh: () => Promise<void>;
}) => {
  const [mode, setMode] = useState<ConnectMode>(autoApprove ? "auto" : "interactive");
  const [cookie, setCookie] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState("");

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setRefusal("");
    try {
      await action();
    } catch (caught) {
      setRefusal(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const connect = () =>
    run(() =>
      connectOAuth({
        request: {
          mode,
          cookie: cookie || undefined,
          projectId: projectId || undefined,
        },
      }),
    );

  return (
    <Panel title="Connect OAuth">
      <Stack gap={3}>
        <Inline gap={3} wrap>
          <Select
            label="Mode"
            options={modeOptions}
            value={mode}
            onChange={(value) => isMode(value) && setMode(value)}
          />
          {mode === "auto" && (
            <Input
              label="Cookie"
              placeholder="better-auth.session_token=..."
              hint={
                autoApprove ? `Default sign-in: ${autoApprove}` : "Needed unless the sim signs in"
              }
              value={cookie}
              onChange={setCookie}
            />
          )}
          <Input
            label="Project id"
            placeholder={defaultProject ?? ""}
            value={projectId}
            onChange={setProjectId}
          />
        </Inline>
        <Inline gap={2}>
          <Button
            variant="primary"
            loading={busy}
            disabled={waiting}
            onClick={() => void connect()}
          >
            Connect OAuth
          </Button>
          <Button disabled={!connected || busy} onClick={() => void run(forgetGrant)}>
            Forget
          </Button>
        </Inline>
        {refusal !== "" && <SimRefusal message={refusal} />}
      </Stack>
    </Panel>
  );
};

/** Where the sim points, whose key it carries (never the key itself) and the OAuth grant. */
export const SetupView = ({ status, error, refresh }: ViewProps) => {
  const waiting = status?.runs.find((run) => run.state === "waiting");
  return (
    <Section
      title="Setup"
      description="The hosted MCP endpoint the sim talks to, the key it sends and the OAuth grant it holds."
    >
      <Stack gap={4}>
        {error && status === undefined ? (
          <SimRefusal message={error.message} />
        ) : (
          status && (
            <>
              {waiting && <AuthorizeBanner run={waiting} />}
              <Panel title="Target">
                <KeyValue
                  items={[
                    { label: "Stack", value: status.stack || "none" },
                    { label: "Endpoint", value: status.endpoint || "none" },
                    {
                      label: "API key",
                      value: status.keyHint
                        ? `${status.keyHint} (from ${status.keySource ?? "the sim's config"})`
                        : "none",
                      copy: false,
                    },
                    { label: "Project", value: status.projectId || "none" },
                    { label: "Callback URL", value: status.callbackUrl },
                    { label: "Auto-approve", value: status.autoApprove || "off", copy: false },
                  ]}
                />
              </Panel>
              <GrantPanel grant={status.oauth} />
              <ConnectPanel
                autoApprove={status.autoApprove}
                defaultProject={status.projectId}
                connected={status.oauth.connected}
                waiting={waiting !== undefined}
                refresh={refresh}
              />
            </>
          )
        )}
      </Stack>
    </Section>
  );
};
