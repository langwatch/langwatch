import {
  Badge,
  Button,
  ConfirmButton,
  Inline,
  Input,
  List,
  ListItem,
  Panel,
  Select,
  Stack,
  Text,
} from "@langwatch/design-system-internal";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { emptySchema, request, signInSchema, type SignInView, type TenantView } from "../api.ts";
import { RefusalCallout } from "../refusal-callout.tsx";
import { useAct } from "../use-act.ts";

/** The one-shot breaks `POST /control/t/{n}/tamper` arms; "none" disarms. */
export const TAMPER_MODES = [
  { value: "none", label: "Nothing: sign the next response properly" },
  { value: "bad-signature", label: "ID token: bad signature" },
  { value: "wrong-audience", label: "ID token: wrong audience" },
  { value: "expired", label: "ID token: expired" },
  { value: "replayed-nonce", label: "ID token: replayed nonce" },
  { value: "saml-bad-signature", label: "SAML: bad signature" },
  { value: "saml-unsigned", label: "SAML: unsigned" },
  { value: "saml-wrong-audience", label: "SAML: wrong audience" },
  { value: "saml-wrong-recipient", label: "SAML: wrong recipient" },
  { value: "saml-expired", label: "SAML: expired" },
  { value: "saml-not-yet-valid", label: "SAML: not yet valid" },
  { value: "saml-replayed-assertion", label: "SAML: replayed assertion" },
  { value: "saml-wrong-in-response-to", label: "SAML: wrong InResponseTo" },
];

const keysSchema = z.object({ current: z.string(), published: z.array(z.string()) });
const unsolicitedSchema = z.object({
  url: z.string(),
  samlResponse: z.string(),
  relayState: z.string(),
});
type Unsolicited = z.infer<typeof unsolicitedSchema>;

const skewText = ({ seconds }: { seconds: number }) => {
  if (seconds === 0) return "none";
  return seconds > 0 ? `${seconds}s ahead` : `${-seconds}s behind`;
};

/**
 * How the tenant signs and how to make it sign badly: key rotation, clock
 * skew, a one-shot broken token or SAML response, an IdP-initiated SAML
 * response, sign-in links and a reset. The control API's twin, for people.
 */
export const SigningTab = ({ tenant, reload }: { tenant: TenantView; reload: () => void }) => {
  const { act, busy, refusal } = useAct({ onDone: reload });
  const control = `/control/t/${tenant.id}`;
  const keys = tenant.signing?.keys ?? [];
  const [skew, setSkew] = useState(String(tenant.signing?.skewSeconds ?? 0));
  const [mode, setMode] = useState(tenant.signing?.armed || "none");
  /* Every reload brings a fresh tenant: re-seed the inputs so a reset does not leave stale ones. */
  const [seededFrom, setSeededFrom] = useState(tenant);
  if (seededFrom !== tenant) {
    setSeededFrom(tenant);
    setSkew(String(tenant.signing?.skewSeconds ?? 0));
    setMode(tenant.signing?.armed || "none");
  }
  const [acsUrl, setAcsUrl] = useState("");
  const [entityId, setEntityId] = useState("");
  const [email, setEmail] = useState(tenant.users[0]?.email ?? "");
  const [relayState, setRelayState] = useState("");
  const [response, setResponse] = useState<Unsolicited | undefined>(undefined);
  const [client, setClient] = useState("");
  const [redirect, setRedirect] = useState("");
  const [signIn, setSignIn] = useState<SignInView | undefined>(undefined);

  const rotate = ({ dropPrevious }: { dropPrevious: boolean }) =>
    void act({
      name: dropPrevious ? "drop" : "rotate",
      path: `${control}/rotate-key`,
      method: "POST",
      body: { dropPrevious },
      schema: keysSchema,
    });
  const applySkew = (event: FormEvent) => {
    event.preventDefault();
    void act({
      name: "skew",
      path: `${control}/config`,
      method: "POST",
      body: { skewSeconds: Number.parseInt(skew, 10) || 0 },
      schema: emptySchema,
    });
  };
  const arm = (event: FormEvent) => {
    event.preventDefault();
    void act({
      name: "tamper",
      path: `${control}/tamper`,
      method: "POST",
      body: { mode },
      schema: emptySchema,
    });
  };
  const unsolicited = async (event: FormEvent) => {
    event.preventDefault();
    setResponse(
      await act({
        name: "unsolicited",
        path: `${control}/saml/unsolicited`,
        method: "POST",
        body: { acsUrl, entityId, email, relayState },
        schema: unsolicitedSchema,
      }),
    );
  };
  const listSignIn = async (event: FormEvent) => {
    event.preventDefault();
    const query = new URLSearchParams();
    if (client !== "") query.set("client_id", client);
    if (redirect !== "") query.set("redirect_uri", redirect);
    const answer = await request({
      path: `/api/t/${tenant.id}/sign-in?${query.toString()}`,
      schema: signInSchema,
    });
    setSignIn(answer.ok ? answer.data : undefined);
  };

  return (
    <Stack gap={8}>
      <RefusalCallout refusal={refusal} />
      <Panel title="Signing keys" meta={`${keys.length} published`}>
        <Stack gap={4}>
          <Inline gap={2} wrap>
            {keys.map((kid, index) => (
              <Badge key={kid} tone={index === 0 ? "ok" : undefined}>
                {index === 0 ? `${kid} (signs)` : `${kid} (still published)`}
              </Badge>
            ))}
          </Inline>
          <Text tone="secondary">
            Rotating makes a fresh key sign while the old one stays in the JWKS and the SAML
            metadata, as a real provider does. Dropping the previous key is the moment a relying
            party that cached it starts failing.
          </Text>
          <Inline gap={2}>
            <Button loading={busy === "rotate"} onClick={() => rotate({ dropPrevious: false })}>
              Rotate the key
            </Button>
            <ConfirmButton
              label="Drop the previous key"
              disabled={keys.length < 2}
              onConfirm={() => rotate({ dropPrevious: true })}
            />
          </Inline>
        </Stack>
      </Panel>
      <Panel title="Clock skew" meta={skewText({ seconds: tenant.signing?.skewSeconds ?? 0 })}>
        <form onSubmit={applySkew}>
          <Stack gap={4}>
            <Input
              label="Skew in seconds"
              hint="Every token and assertion is stamped this far off; negative runs behind. Reset clears it."
              type="number"
              step={1}
              value={skew}
              onChange={setSkew}
            />
            <div>
              <Button type="submit" loading={busy === "skew"}>
                Apply skew
              </Button>
            </div>
          </Stack>
        </form>
      </Panel>
      <Panel title="Break the next response" meta={tenant.signing?.armed || "nothing armed"}>
        <form onSubmit={arm}>
          <Stack gap={4}>
            <Select
              label="Break"
              hint="One shot: the next ID token or SAML response carries it, then signing is honest again."
              options={TAMPER_MODES}
              value={mode}
              onChange={setMode}
            />
            <div>
              <Button type="submit" loading={busy === "tamper"}>
                Arm
              </Button>
            </div>
          </Stack>
        </form>
      </Panel>
      <Panel title="IdP-initiated SAML response">
        <Stack gap={4}>
          <form onSubmit={(event) => void unsolicited(event)}>
            <Stack gap={4}>
              <Input label="ACS address" mono required value={acsUrl} onChange={setAcsUrl} />
              <Input
                label="SP entity id"
                hint="Empty uses the ACS address."
                mono
                value={entityId}
                onChange={setEntityId}
              />
              <Input label="User email" required value={email} onChange={setEmail} />
              <Input label="RelayState" mono value={relayState} onChange={setRelayState} />
              <div>
                <Button type="submit" loading={busy === "unsolicited"}>
                  Sign an unsolicited response
                </Button>
              </div>
            </Stack>
          </form>
          {response !== undefined && (
            <form method="post" action={response.url} target="_blank">
              <input type="hidden" name="SAMLResponse" value={response.samlResponse} />
              <input type="hidden" name="RelayState" value={response.relayState} />
              <Button variant="primary" type="submit">
                Post it to the ACS
              </Button>
            </form>
          )}
        </Stack>
      </Panel>
      <Panel title="Sign in">
        <form onSubmit={(event) => void listSignIn(event)}>
          <Stack gap={4}>
            <Input label="Client id" mono value={client} onChange={setClient} />
            <Input label="Redirect address" mono value={redirect} onChange={setRedirect} />
            <div>
              <Button type="submit">List sign-in links</Button>
            </div>
            {signIn?.refusal != null && (
              <Text tone="secondary">{`${signIn.refusal.title}. ${signIn.refusal.hint}`}</Text>
            )}
            {signIn !== undefined && signIn.users.length > 0 && (
              <List label="Sign-in links">
                {signIn.users.map((user) => (
                  <ListItem
                    key={user.href}
                    title={user.name}
                    description={user.email}
                    href={user.href}
                  />
                ))}
              </List>
            )}
          </Stack>
        </form>
      </Panel>
      <Panel title="Reset">
        <Inline gap={4}>
          <Text tone="secondary">
            Puts the tenant back as it was seeded and clears its clock skew; signing keys stay.
          </Text>
          <ConfirmButton
            label="Reset tenant"
            onConfirm={() =>
              void act({
                name: "reset",
                path: `${control}/reset`,
                method: "POST",
                schema: emptySchema,
              })
            }
          />
        </Inline>
      </Panel>
    </Stack>
  );
};
