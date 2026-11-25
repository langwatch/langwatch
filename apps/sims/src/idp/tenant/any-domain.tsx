import {
  Button,
  Callout,
  Inline,
  Input,
  Panel,
  Stack,
  Textarea,
} from "@langwatch/design-system-internal";
import { useState, type FormEvent } from "react";

import { emptySchema } from "../api.ts";
import { RefusalCallout } from "../refusal-callout.tsx";
import { useAct } from "../use-act.ts";

/** A TXT record on a domain no tenant owns: `PUT/DELETE /control/dns/txt`. */
const TxtRecordPanel = ({ reload }: { reload: () => void }) => {
  const { act, busy, refusal } = useAct({ onDone: reload });
  const [domain, setDomain] = useState("");
  const [values, setValues] = useState("");
  const [done, setDone] = useState<string | undefined>(undefined);
  const send = async ({ remove }: { remove: boolean }) => {
    const lines = values
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    const answer = await act({
      name: remove ? "txt-remove" : "txt-publish",
      path: "/control/dns/txt",
      method: remove ? "DELETE" : "PUT",
      body: remove ? { domain } : { domain, values: lines },
      schema: emptySchema,
    });
    if (answer === undefined) return;
    setDone(remove ? `Removed the TXT record at ${domain}.` : `Published at ${domain}.`);
  };
  const publish = (event: FormEvent) => {
    event.preventDefault();
    void send({ remove: false });
  };
  return (
    <Panel title="A TXT record on any domain" meta="answered by this machine's DNS">
      <form onSubmit={publish}>
        <Stack gap={4}>
          <Input
            label="TXT domain"
            placeholder="_anything.example.test"
            hint="The exact name: no label is added."
            mono
            required
            value={domain}
            onChange={setDomain}
          />
          <Textarea
            label="TXT values"
            hint="One value per line. Publishing replaces what the name answered before."
            mono
            rows={2}
            value={values}
            onChange={setValues}
          />
          <Inline gap={2}>
            <Button type="submit" loading={busy === "txt-publish"}>
              Publish TXT
            </Button>
            <Button
              loading={busy === "txt-remove"}
              disabled={domain === ""}
              onClick={() => void send({ remove: true })}
            >
              Remove TXT
            </Button>
          </Inline>
          {done !== undefined && <Callout tone="info" title={done} />}
          <RefusalCallout refusal={refusal} />
        </Stack>
      </form>
    </Panel>
  );
};

/** The HTTP proof alone: `PUT/DELETE /control/verification` serves a token under /.well-known/. */
const VerificationFilePanel = ({ reload }: { reload: () => void }) => {
  const { act, busy, refusal } = useAct({ onDone: reload });
  const [domain, setDomain] = useState("");
  const [token, setToken] = useState("");
  const [done, setDone] = useState<string | undefined>(undefined);
  const send = async ({ remove }: { remove: boolean }) => {
    const answer = await act({
      name: remove ? "file-remove" : "file-serve",
      path: "/control/verification",
      method: remove ? "DELETE" : "PUT",
      body: remove ? { domain } : { domain, token },
      schema: emptySchema,
    });
    if (answer === undefined) return;
    setDone(remove ? `Stopped serving the file for ${domain}.` : `Serving the file for ${domain}.`);
  };
  const serve = (event: FormEvent) => {
    event.preventDefault();
    void send({ remove: false });
  };
  return (
    <Panel title="Well-known verification file" meta="the HTTP proof only, no TXT record">
      <form onSubmit={serve}>
        <Stack gap={4}>
          <Input
            label="File domain"
            placeholder="acme.test"
            mono
            required
            value={domain}
            onChange={setDomain}
          />
          <Input
            label="Token"
            hint="Served as the domain's well-known verification file."
            mono
            required
            autoComplete="off"
            value={token}
            onChange={setToken}
          />
          <Inline gap={2}>
            <Button type="submit" loading={busy === "file-serve"}>
              Serve the file
            </Button>
            <Button
              loading={busy === "file-remove"}
              disabled={domain === ""}
              onClick={() => void send({ remove: true })}
            >
              Stop serving
            </Button>
          </Inline>
          {done !== undefined && <Callout tone="info" title={done} />}
          <RefusalCallout refusal={refusal} />
        </Stack>
      </form>
    </Panel>
  );
};

/** Proofs for any domain, one channel at a time: what a test of a half-published proof needs. */
export const AnyDomainProofs = ({ reload }: { reload: () => void }) => (
  <Stack gap={4}>
    <TxtRecordPanel reload={reload} />
    <VerificationFilePanel reload={reload} />
  </Stack>
);
