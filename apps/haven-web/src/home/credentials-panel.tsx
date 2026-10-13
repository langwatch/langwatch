import {
  Button,
  IconCheck,
  IconCopy,
  KeyValue,
  Link,
  Panel,
  writeClipboardText,
  type KeyValueItem,
} from "@langwatch/design-system-internal";
import { useEffect, useRef, useState } from "react";

import { revealApiKey } from "../shared/api.ts";
import type { Credentials } from "../shared/contract.ts";

const COPIED_MS = 1500;

type CopyState = "idle" | "copying" | "copied" | "failed";

const WORDS: Record<CopyState, string> = {
  idle: "Copy API key",
  copying: "Copy API key",
  copied: "Copied",
  failed: "Copy failed",
};

/** Asks the daemon for the key only on copy, so the page never holds or prints it. */
const CopyApiKey = ({ revealPath }: { revealPath: string }) => {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const settle = ({ next }: { next: CopyState }) => {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), COPIED_MS);
  };
  const copy = () => {
    setState("copying");
    void revealApiKey({ path: revealPath })
      .then((apiKey) => writeClipboardText({ text: apiKey }))
      .then(() => settle({ next: "copied" }))
      .catch(() => settle({ next: "failed" }));
  };
  return (
    <Button
      size="sm"
      loading={state === "copying"}
      icon={state === "copied" ? <IconCheck /> : <IconCopy />}
      onClick={copy}
    >
      {WORDS[state]}
    </Button>
  );
};

const tenantItems = ({ credentials }: { credentials: Credentials }): KeyValueItem[] => {
  if (credentials.idpTenants.length === 0) {
    return [
      {
        label: "IdP tenants",
        value: "None while the IdP simulator is down",
        mono: false,
        copy: false,
      },
    ];
  }
  return credentials.idpTenants.map((tenant) => ({
    label: `IdP ${tenant.domain}`,
    value: (
      <Link href={tenant.url} mono>
        {tenant.url}
      </Link>
    ),
    copy: tenant.url,
  }));
};

export const CredentialsPanel = ({ credentials }: { credentials: Credentials }) => {
  const { apiKey } = credentials;
  const items: KeyValueItem[] = [
    { label: "Login", value: credentials.login.email },
    { label: "Mail address", value: credentials.mailAddress },
    ...tenantItems({ credentials }),
    apiKey === null
      ? { label: "API key", value: "Created when the stack comes up", mono: false, copy: false }
      : { label: "API key", value: apiKey.masked, copy: false },
  ];
  return (
    <Panel
      title="Dev credentials"
      actions={apiKey === null ? undefined : <CopyApiKey revealPath={apiKey.revealPath} />}
    >
      <KeyValue items={items} />
    </Panel>
  );
};
