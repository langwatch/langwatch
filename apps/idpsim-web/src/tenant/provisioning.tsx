import {
  Badge,
  Button,
  Callout,
  ConfirmButton,
  Inline,
  Input,
  KeyValue,
  Panel,
  Stack,
  Table,
  Text,
  type TableColumn,
} from "@langwatch/design-system-internal";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import {
  emptySchema,
  outcomeSchema,
  scaleSchema,
  tenantPath,
  type ProvisioningOutcome,
  type TenantView,
} from "../api.ts";
import { RefusalCallout } from "../refusal-callout.tsx";
import { useAct } from "../use-act.ts";

const connectionSchema = z.object({
  configured: z.boolean(),
  baseUrl: z.string(),
  token: z.string(),
});

const OUTCOME_WORD: Record<string, string> = { push: "push", pull: "read-back", sync: "sync" };

type HeldRow = { user: string; group: string };

const heldColumns: TableColumn<HeldRow>[] = [
  { key: "user", header: "Users LangWatch holds", cell: (row) => row.user, mono: true },
  { key: "group", header: "Groups", cell: (row) => row.group, mono: true },
];

/** What the last push, read-back or sync did, including what it could not do. */
const LastOutcome = ({ outcome }: { outcome: ProvisioningOutcome }) => {
  const users = outcome.users ?? [];
  const groups = outcome.groups ?? [];
  const failures = outcome.failures ?? [];
  const rows: HeldRow[] = Array.from(
    { length: Math.max(users.length, groups.length) },
    (_, index) => ({
      user: users[index] ?? "",
      group: groups[index] ?? "",
    }),
  );
  return (
    <Stack gap={4}>
      <Callout
        tone={outcome.refused === true ? "error" : "info"}
        title={`Last ${OUTCOME_WORD[outcome.kind] ?? outcome.kind}: ${outcome.refused === true ? "refused" : "ok"}`}
      >
        {outcome.summary}
      </Callout>
      {rows.length > 0 && (
        <Panel>
          <Table
            columns={heldColumns}
            rows={rows}
            rowKey={(row) => `${row.user}|${row.group}`}
            maxHeight="sm"
          />
        </Panel>
      )}
      {failures.length > 0 && (
        <Panel title="Refused by LangWatch" meta={String(failures.length)}>
          <Stack gap={2}>
            {failures.map((failure) => (
              <Text key={failure} mono size="sm" tone="secondary">
                {failure}
              </Text>
            ))}
          </Stack>
        </Panel>
      )}
    </Stack>
  );
};

const ConnectForm = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => {
  const { act, busy, refusal } = useAct({ onDone: reload });
  const [target, setTarget] = useState("");
  const [token, setToken] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await act({
      name: "connect",
      path: `${tenantPath({ id: tenant.id })}/provisioning`,
      method: "PUT",
      body: { target, token },
      schema: connectionSchema,
    });
    if (saved !== undefined) setToken("");
  };
  return (
    <form onSubmit={(event) => void submit(event)}>
      <Stack gap={4}>
        <Input
          label="SCIM address"
          placeholder="https://app.your-worktree.langwatch.localhost/api/scim/v2"
          hint="On LangWatch's SCIM setup screen. A trailing /Users is trimmed, so the endpoint you were last looking at works too."
          mono
          required
          value={target}
          onChange={setTarget}
        />
        <Input
          label="Token"
          placeholder="the token LangWatch issued"
          hint="SCIM runs one way: LangWatch issues the credential and whoever provisions presents it, so a token invented here would open nothing."
          mono
          required
          autoComplete="off"
          value={token}
          onChange={setToken}
        />
        <RefusalCallout refusal={refusal} />
        <div>
          <Button variant="primary" type="submit" loading={busy === "connect"}>
            Connect
          </Button>
        </div>
      </Stack>
    </form>
  );
};

const Connected = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => {
  const { act, busy, refusal } = useAct({ onDone: reload });
  const base = tenantPath({ id: tenant.id });
  const press = (action: "sync" | "push" | "pull") =>
    void act({
      name: action,
      path: `${base}/provisioning/${action}`,
      method: "POST",
      schema: outcomeSchema,
    });
  return (
    <Stack gap={4}>
      <Panel title="Provision into LangWatch" meta="the way Okta or Entra would">
        <KeyValue
          items={[
            { label: "Provisioning into", value: tenant.provisioning.baseUrl },
            { label: "With the token", value: tenant.provisioning.token, copy: false },
          ]}
        />
      </Panel>
      <Inline gap={2} wrap>
        <Button variant="primary" loading={busy === "sync"} onClick={() => press("sync")}>
          Sync the difference
        </Button>
        <Button loading={busy === "push"} onClick={() => press("push")}>
          Push everything
        </Button>
        <Button loading={busy === "pull"} onClick={() => press("pull")}>
          Read it back
        </Button>
        <ConfirmButton
          label="Forget"
          variant="secondary"
          onConfirm={() =>
            void act({
              name: "forget",
              path: `${base}/provisioning`,
              method: "DELETE",
              schema: emptySchema,
            })
          }
        />
      </Inline>
      <RefusalCallout refusal={refusal} />
      <Text tone="secondary" size="sm">
        Sync reads what LangWatch holds and sends only what changed: creates for arrivals, updates
        for renames, deactivations for departures. Run it after every round of churn and the numbers
        describe the round. Push everything sends every user and group as a create, which is right
        exactly once. Read it back asks LangWatch what it holds now.
      </Text>
    </Stack>
  );
};

type ChurnField = "join" | "leave" | "deactivate" | "reactivate" | "rename" | "regroup";

const CHURN_FIELDS: { key: ChurnField; label: string }[] = [
  { key: "join", label: "Join" },
  { key: "leave", label: "Leave" },
  { key: "deactivate", label: "Deactivate" },
  { key: "reactivate", label: "Reactivate" },
  { key: "rename", label: "Rename" },
  { key: "regroup", label: "Regroup" },
];

const count = ({ text }: { text: string }) => {
  const value = Number.parseInt(text, 10);
  return Number.isNaN(value) ? 0 : value;
};

const ScalePanel = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => {
  const { act, busy, refusal } = useAct({ onDone: reload });
  const [users, setUsers] = useState(String(tenant.scale.users));
  const [groups, setGroups] = useState(String(tenant.scale.groups));
  const [churn, setChurn] = useState<Record<ChurnField, string>>({
    join: "0",
    leave: "0",
    deactivate: "0",
    reactivate: "0",
    rename: "0",
    regroup: "0",
  });
  const base = tenantPath({ id: tenant.id });

  const generate = (event: FormEvent) => {
    event.preventDefault();
    void act({
      name: "generate",
      path: `${base}/population`,
      method: "POST",
      body: { users: count({ text: users }), groups: count({ text: groups }) },
      schema: scaleSchema,
    });
  };
  const applyChurn = (event: FormEvent) => {
    event.preventDefault();
    const body = Object.fromEntries(
      CHURN_FIELDS.map(({ key }) => [key, count({ text: churn[key] })]),
    );
    void act({ name: "churn", path: `${base}/churn`, method: "POST", body, schema: scaleSchema });
  };

  return (
    <Panel title="Directory at scale" meta={`${tenant.users.length.toLocaleString()} people now`}>
      <Stack gap={6}>
        <Text tone="secondary">
          Generate a directory big enough to be worth syncing, then put it through the changes a
          real one goes through between syncs. The admin and member you sign in as are kept, and
          growing keeps everybody already there. Same numbers, same people, every time.
        </Text>
        <form onSubmit={generate}>
          <Inline gap={3} align="end" wrap>
            <div className="idp-number">
              <Input
                label="People"
                type="number"
                min={0}
                max={50000}
                value={users}
                onChange={setUsers}
              />
            </div>
            <div className="idp-number">
              <Input
                label="Groups"
                type="number"
                min={0}
                max={500}
                value={groups}
                onChange={setGroups}
              />
            </div>
            <Button type="submit" loading={busy === "generate"}>
              Generate
            </Button>
          </Inline>
        </form>
        <form onSubmit={applyChurn}>
          <Inline gap={3} align="end" wrap>
            {CHURN_FIELDS.map(({ key, label }) => (
              <div className="idp-count" key={key}>
                <Input
                  label={label}
                  type="number"
                  min={0}
                  value={churn[key]}
                  onChange={(value) => setChurn((current) => ({ ...current, [key]: value }))}
                />
              </div>
            ))}
            <Button type="submit" loading={busy === "churn"}>
              Churn
            </Button>
          </Inline>
        </form>
        <RefusalCallout refusal={refusal} />
        <Text tone="secondary" size="sm">
          Deactivate is what most identity providers send for somebody who has left: the record
          stays and active goes false. Leave is the rarer outright removal. Rename changes the name
          and the address but not the external id, which proves the receiving side matches on the
          id. Then press Sync the difference and read the counts.
        </Text>
        {tenant.scale.last !== "" && (
          <Inline gap={2}>
            <Badge>Last change</Badge>
            <Text>{tenant.scale.last}</Text>
          </Inline>
        )}
      </Stack>
    </Panel>
  );
};

export const ProvisioningTab = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => (
  <Stack gap={8}>
    <Stack gap={4}>
      {tenant.provisioning.configured ? (
        <Connected tenant={tenant} reload={reload} />
      ) : (
        <Panel title="Provision into LangWatch" meta="the way Okta or Entra would">
          <ConnectForm tenant={tenant} reload={reload} />
        </Panel>
      )}
      {tenant.lastProvisioning !== null && <LastOutcome outcome={tenant.lastProvisioning} />}
    </Stack>
    <ScalePanel tenant={tenant} reload={reload} />
  </Stack>
);
