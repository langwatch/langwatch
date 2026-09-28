import {
  Badge,
  Inline,
  Input,
  Panel,
  Section,
  Stack,
  Table,
  Text,
  type TableColumn,
} from "@langwatch/design-system-internal";
import { useMemo, useState } from "react";

import type { TenantView, User } from "../api.ts";

/** A generated directory runs to fifty thousand people; the table shows this many at once. */
export const USERS_SHOWN = 500;

const displayName = ({ user }: { user: User }) =>
  `${user.givenName} ${user.familyName}`.trim() || user.userName;

const columns: TableColumn<User>[] = [
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

export const UsersTab = ({ tenant }: { tenant: TenantView }) => {
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
