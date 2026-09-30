import {
  Button,
  Callout,
  Inline,
  Input,
  List,
  ListItem,
  Panel,
  Section,
  Stack,
  Text,
} from "@langwatch/design-system-internal";
import { SimConsole } from "@langwatch/sim-console";
import { useMemo, useState } from "react";

import { signInSchema, type SignInView } from "./api.ts";
import { answerStatus, useAnswer } from "./use-answer.ts";

/** A generated directory runs to thousands; the picker lists this many at once. */
export const ACCOUNTS_SHOWN = 25;

type Account = SignInView["users"][number];

/** Accounts whose name or address contains what was typed, capped for the list. */
export const matchAccounts = ({ users, needle }: { users: Account[]; needle: string }) => {
  const wanted = needle.trim().toLowerCase();
  const matched =
    wanted === ""
      ? users
      : users.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(wanted));
  return { total: matched.length, shown: matched.slice(0, ACCOUNTS_SHOWN) };
};

/**
 * The account picker an authorize request without a login hint lands on. Each
 * account links back into the same request with the hint filled in, so the
 * protocol endpoint, not this page, mints the code and sends the browser on.
 */
export const SignIn = ({ tenantId, query }: { tenantId: number; query: string }) => {
  const { data, refusal } = useAnswer({
    path: `/api/t/${tenantId}/sign-in${query === "" ? "" : `?${query}`}`,
    schema: signInSchema,
  });
  const notice = refusal ?? data?.refusal ?? undefined;
  const [needle, setNeedle] = useState("");
  const { total, shown } = useMemo(
    () => matchAccounts({ users: data?.users ?? [], needle }),
    [data, needle],
  );
  const subtitle =
    data === undefined
      ? `Simulated identity provider, tenant ${tenantId}`
      : `Simulated identity provider, tenant ${tenantId} (${data.domain})`;

  return (
    <SimConsole
      sim="idp"
      title="IdP simulator"
      tabs={[]}
      activeTab=""
      onTab={() => undefined}
      status={answerStatus({ loaded: data !== undefined, refused: refusal !== undefined })}
    >
      <div className="idp-narrow">
        <Section
          title={notice === undefined ? "Choose an account" : notice.title}
          description={subtitle}
        >
          <Stack gap={4}>
            {notice !== undefined ? (
              <>
                <Callout tone="error" title={notice.detail}>
                  {notice.hint}
                </Callout>
                <div>
                  <Button href={`/t/${tenantId}/`}>{`Open tenant ${tenantId}`}</Button>
                </div>
              </>
            ) : (
              <>
                {data !== undefined && data.users.length > ACCOUNTS_SHOWN && (
                  <Inline gap={3} wrap>
                    <div className="idp-grow">
                      <Input
                        label="Find an account"
                        hideLabel
                        type="search"
                        placeholder="Name or email"
                        autoComplete="off"
                        value={needle}
                        onChange={setNeedle}
                      />
                    </div>
                    <Text tone="muted">{`Showing ${shown.length} of ${total.toLocaleString()}`}</Text>
                  </Inline>
                )}
                <Panel
                  title="Sign in as"
                  meta={
                    data === undefined ? undefined : `${data.users.length.toLocaleString()} people`
                  }
                >
                  {data !== undefined && data.users.length === 0 ? (
                    <Text tone="secondary">
                      This tenant has no active users to sign in as. Reset it from the control API
                      to bring its seeded users back.
                    </Text>
                  ) : (
                    <List label="Accounts">
                      {shown.map((user) => (
                        <ListItem
                          key={user.href}
                          title={user.name}
                          description={user.email}
                          href={user.href}
                        />
                      ))}
                    </List>
                  )}
                </Panel>
                <Text tone="muted" size="sm">
                  There are no passwords: picking a person is the whole ceremony. Scripts skip this
                  page with login_hint=&lt;email&gt; on the authorization request.
                </Text>
              </>
            )}
          </Stack>
        </Section>
      </div>
    </SimConsole>
  );
};
