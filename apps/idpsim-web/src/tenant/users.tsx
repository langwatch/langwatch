import {
  Badge,
  Button,
  Inline,
  Input,
  Panel,
  Section,
  Stack,
  Table,
  Text,
  type TableColumn,
} from "@langwatch/design-system-internal";
import { useMemo, useState, type FormEvent } from "react";

import { userSchema, type TenantView, type User } from "../api.ts";
import { RefusalCallout } from "../refusal-callout.tsx";
import { useAct } from "../use-act.ts";

/** A generated directory runs to fifty thousand people; the table shows this many at once. */
export const USERS_SHOWN = 500;

const displayName = ({ user }: { user: User }) =>
  `${user.givenName} ${user.familyName}`.trim() || user.userName;

const userColumns = ({
  busy,
  onToggle,
}: {
  busy: string | undefined;
  onToggle: (args: { user: User }) => void;
}): TableColumn<User>[] => [
  { key: "email", header: "Email", cell: (user) => user.email, mono: true },
  { key: "name", header: "Name", cell: (user) => displayName({ user }), hideOnNarrow: true },
  {
    key: "groups",
    header: "Groups",
    cell: (user) => (user.groups ?? []).join(", "),
    muted: true,
    hideOnNarrow: true,
  },
  {
    key: "status",
    header: "Status",
    cell: (user) =>
      user.active ? <Badge tone="ok">active</Badge> : <Badge tone="error">inactive</Badge>,
    width: "128px",
  },
  {
    key: "toggle",
    header: "At the IdP",
    cell: (user) => (
      <Button
        size="sm"
        variant="secondary"
        loading={busy === user.email}
        title={`${user.active ? "Disable" : "Enable"} ${user.email} at the IdP`}
        onClick={() => onToggle({ user })}
      >
        {user.active ? "Disable" : "Enable"}
      </Button>
    ),
    width: "128px",
  },
];

/** People whose address, name or group contains what was typed, capped for the table. */
export const matchUsers = ({ users, needle }: { users: User[]; needle: string }) => {
  const wanted = needle.trim().toLowerCase();
  const matched =
    wanted === ""
      ? users
      : users.filter((user) =>
          [user.email, displayName({ user }), ...(user.groups ?? [])]
            .join(" ")
            .toLowerCase()
            .includes(wanted),
        );
  return { total: matched.length, shown: matched.slice(0, USERS_SHOWN) };
};

const splitList = ({ text }: { text: string }) =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

const AddPersonForm = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => {
  const { act, busy, refusal } = useAct({ onDone: reload });
  const [email, setEmail] = useState("");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [groups, setGroups] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const added = await act({
      name: "add",
      path: `/control/t/${tenant.id}/users`,
      method: "POST",
      body: { email, givenName, familyName, groups: splitList({ text: groups }) },
      schema: userSchema,
    });
    if (added === undefined) return;
    setEmail("");
    setGivenName("");
    setFamilyName("");
    setGroups("");
  };
  return (
    <Panel title="Add a person" meta="active from the start">
      <form onSubmit={(event) => void submit(event)}>
        <Stack gap={4}>
          <Inline gap={3} align="end" wrap>
            <Input label="Email" type="email" required mono value={email} onChange={setEmail} />
            <Input label="Given name" value={givenName} onChange={setGivenName} />
            <Input label="Family name" value={familyName} onChange={setFamilyName} />
            <Input
              label="Groups"
              placeholder="Everyone, Admins"
              value={groups}
              onChange={setGroups}
            />
            <Button type="submit" loading={busy === "add"}>
              Add
            </Button>
          </Inline>
          <RefusalCallout refusal={refusal} />
        </Stack>
      </form>
    </Panel>
  );
};

export const UsersTab = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => {
  const { act, busy, refusal } = useAct({ onDone: reload });
  const columns = userColumns({
    busy,
    onToggle: ({ user }) =>
      void act({
        name: user.email,
        path: `/control/t/${tenant.id}/user-active`,
        method: "POST",
        body: { user: user.email, active: !user.active },
        schema: userSchema,
      }),
  });
  const [needle, setNeedle] = useState("");
  const { total, shown } = useMemo(
    () => matchUsers({ users: tenant.users, needle }),
    [tenant.users, needle],
  );
  return (
    <Section
      title="Users"
      description="A login started from your application lands on the account picker, where you choose one of these. There are no passwords. Scripts skip the picker with login_hint=<email> on the authorization request."
    >
      <Stack gap={4}>
        <AddPersonForm tenant={tenant} reload={reload} />
        <RefusalCallout refusal={refusal} />
        <Inline gap={3} wrap>
          <div className="idp-grow">
            <Input
              label="Find a person"
              hideLabel
              type="search"
              placeholder="Email, name or group"
              autoComplete="off"
              value={needle}
              onChange={setNeedle}
            />
          </div>
          <Text tone="muted">
            {total > shown.length
              ? `Showing ${shown.length.toLocaleString()} of ${total.toLocaleString()}`
              : `${total.toLocaleString()} people`}
          </Text>
        </Inline>
        <Panel>
          <Table
            columns={columns}
            rows={shown}
            rowKey={(user) => user.id}
            caption="The tenant's directory"
            empty="Nobody matches."
            maxHeight="lg"
          />
        </Panel>
      </Stack>
    </Section>
  );
};
