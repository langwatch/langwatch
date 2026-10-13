import {
  Button,
  Callout,
  Checkbox,
  Inline,
  Input,
  Panel,
  Select,
  Stack,
  Text,
  Textarea,
} from "@langwatch/design-system-internal";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import type { TenantView } from "../api.ts";
import { RefusalCallout } from "../refusal-callout.tsx";
import { useAct } from "../use-act.ts";

const SCIM_EVENT_KINDS = [
  "user.lookup",
  "user.create",
  "user.replace",
  "user.patch",
  "user.deactivate",
  "user.reactivate",
  "user.delete",
  "group.lookup",
  "group.create",
  "group.add-member",
  "group.remove-member",
  "group.rename",
  "group.delete",
].map((kind) => ({ value: kind, label: kind }));

const STYLES = [
  { value: "okta", label: "Okta (value objects)" },
  { value: "entra", label: "Entra (paths)" },
];

const scimEventAnswerSchema = z.object({
  event: z.object({ response: z.object({ status: z.number() }) }),
});

const webhookAnswerSchema = z.object({ status: z.number(), event: z.string(), user: z.string() });

/** "true" and "false" read as booleans, as the active attribute needs, like the CLI's `--set`. */
const typedValue = ({ raw }: { raw: string }) => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
};

/** One `key=value` per line; the first line without one is returned as the error. */
export const parseSetLines = ({
  text,
}: {
  text: string;
}): { set: Record<string, string | boolean> } | { error: string } => {
  const set: Record<string, string | boolean> = {};
  for (const line of text.split("\n").map((item) => item.trim())) {
    if (line === "") continue;
    const at = line.indexOf("=");
    if (at <= 0) return { error: `"${line}" is not key=value` };
    set[line.slice(0, at)] = typedValue({ raw: line.slice(at + 1) });
  }
  return { set };
};

/** The optional fields, sent only when filled in, so a plain event's body stays plain. */
const optionalFields = ({
  id,
  memberId,
  set,
  inactive,
  noExternalId,
  enterprise,
}: {
  id: string;
  memberId: string;
  set: Record<string, string | boolean>;
  inactive: boolean;
  noExternalId: boolean;
  enterprise: { department: string; costCenter: string; manager: string };
}) => {
  const filledEnterprise = Object.fromEntries(
    Object.entries(enterprise).filter(([, value]) => value !== ""),
  );
  return {
    ...(id === "" ? {} : { id }),
    ...(memberId === "" ? {} : { memberId }),
    ...(Object.keys(set).length === 0 ? {} : { set }),
    ...(inactive ? { inactive } : {}),
    ...(noExternalId ? { noExternalId } : {}),
    ...(Object.keys(filledEnterprise).length === 0 ? {} : { enterprise: filledEnterprise }),
  };
};

/** One SCIM request as an IdP would send it, through the tenant's connection. */
const ScimEventPanel = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => {
  const { act, busy, refusal } = useAct({ onDone: reload });
  const [kind, setKind] = useState("user.patch");
  const [style, setStyle] = useState("okta");
  const [user, setUser] = useState("");
  const [group, setGroup] = useState("");
  const [id, setId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [setText, setSetText] = useState("");
  const [setError, setSetError] = useState<string | undefined>(undefined);
  const [inactive, setInactive] = useState(false);
  const [noExternalId, setNoExternalId] = useState(false);
  const [department, setDepartment] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const [manager, setManager] = useState("");
  const [answered, setAnswered] = useState<number | undefined>(undefined);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseSetLines({ text: setText });
    if ("error" in parsed) {
      setSetError(parsed.error);
      return;
    }
    setSetError(undefined);
    const optional = optionalFields({
      id,
      memberId,
      set: parsed.set,
      inactive,
      noExternalId,
      enterprise: { department, costCenter, manager },
    });
    const answer = await act({
      name: "scim-event",
      path: `/control/t/${tenant.id}/scim-event`,
      method: "POST",
      body: { kind, style, user, group, ...optional },
      schema: scimEventAnswerSchema,
    });
    setAnswered(answer?.event.response.status);
  };
  return (
    <Panel title="Send one SCIM event" meta="through the connection above">
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap={4}>
          <Inline gap={3} align="end" wrap>
            <Select label="Event" options={SCIM_EVENT_KINDS} value={kind} onChange={setKind} />
            <Select label="PATCH style" options={STYLES} value={style} onChange={setStyle} />
            <Input label="Person" placeholder="email or id" mono value={user} onChange={setUser} />
            <Input label="Group" placeholder="name or id" value={group} onChange={setGroup} />
            <Button type="submit" loading={busy === "scim-event"}>
              Send event
            </Button>
          </Inline>
          <details>
            <summary>Advanced: ids, attributes, enterprise extension</summary>
            <Stack gap={4}>
              <Inline gap={3} wrap>
                <Input
                  label="Their id"
                  hint="LangWatch's id for the person or group; looked up when empty."
                  mono
                  value={id}
                  onChange={setId}
                />
                <Input
                  label="Their member id"
                  hint="For add-member and remove-member."
                  mono
                  value={memberId}
                  onChange={setMemberId}
                />
              </Inline>
              <Textarea
                label="Set attributes"
                hint="One key=value per line: givenName, familyName, userName, email, active, displayName. On a patch it is exactly what changes."
                mono
                rows={3}
                error={setError}
                value={setText}
                onChange={setSetText}
              />
              <Inline gap={4} wrap>
                <Checkbox label="Create inactive" checked={inactive} onChange={setInactive} />
                <Checkbox
                  label="Leave out externalId"
                  checked={noExternalId}
                  onChange={setNoExternalId}
                />
              </Inline>
              <Inline gap={3} wrap>
                <Input label="Department" value={department} onChange={setDepartment} />
                <Input label="Cost center" value={costCenter} onChange={setCostCenter} />
                <Input
                  label="Manager"
                  placeholder="manager's id"
                  value={manager}
                  onChange={setManager}
                />
              </Inline>
            </Stack>
          </details>
          {answered !== undefined && (
            <Callout tone="info" title={`LangWatch answered ${answered}`}>
              The exchange is in the Activity tab.
            </Callout>
          )}
          <RefusalCallout refusal={refusal} />
        </Stack>
      </form>
    </Panel>
  );
};

/** Auth0 has no SCIM client: it posts signed webhooks a stack turns into SCIM. */
const Auth0WebhookPanel = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => {
  const { act, busy, refusal } = useAct({ onDone: reload });
  const [hookEvent, setHookEvent] = useState("create");
  const [user, setUser] = useState("");
  const [target, setTarget] = useState("");
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [answered, setAnswered] = useState<number | undefined>(undefined);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const answer = await act({
      name: "auth0-webhook",
      path: `/control/t/${tenant.id}/auth0-webhook`,
      method: "POST",
      body: { event: hookEvent, user, target, secret, token },
      schema: webhookAnswerSchema,
    });
    setAnswered(answer?.status);
  };
  return (
    <Panel title="Send an Auth0 SCIM webhook" meta="signed with the secret you give">
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap={4}>
          <Inline gap={3} align="end" wrap>
            <Select
              label="Webhook event"
              options={[
                { value: "create", label: "create" },
                { value: "deactivate", label: "deactivate" },
              ]}
              value={hookEvent}
              onChange={setHookEvent}
            />
            <Input
              label="Webhook person"
              placeholder="email or id"
              mono
              required
              value={user}
              onChange={setUser}
            />
          </Inline>
          <Input
            label="Stack address"
            placeholder="https://app.your-worktree.langwatch.localhost"
            mono
            required
            value={target}
            onChange={setTarget}
          />
          <Inline gap={3} wrap>
            <Input
              label="Webhook secret"
              type="password"
              required
              autoComplete="off"
              value={secret}
              onChange={setSecret}
            />
            <Input
              label="Bearer token"
              hint="Only if the stack wants one too."
              type="password"
              autoComplete="off"
              value={token}
              onChange={setToken}
            />
          </Inline>
          <div>
            <Button type="submit" loading={busy === "auth0-webhook"}>
              Send webhook
            </Button>
          </div>
          {answered !== undefined && (
            <Callout tone="info" title={`The stack answered ${answered}`}>
              The send is in the Activity tab.
            </Callout>
          )}
          <RefusalCallout refusal={refusal} />
          <Text tone="secondary" size="sm">
            Use the secret LangWatch shows on its Auth0 SCIM setup screen.
          </Text>
        </Stack>
      </form>
    </Panel>
  );
};

export const DirectoryEvents = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => (
  <Stack gap={4}>
    {tenant.provisioning.configured && <ScimEventPanel tenant={tenant} reload={reload} />}
    <Auth0WebhookPanel tenant={tenant} reload={reload} />
  </Stack>
);
