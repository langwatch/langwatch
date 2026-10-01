import { INGESTION_PERMISSIONS } from "@langwatch/api-key-contract";
import { useRef, useState } from "react";

import { apiKeyClient } from "./api-key-client.ts";
import {
  personalTokenInput,
  type TokenPermission,
  tokenScopeNote,
} from "./personal-token-scope.ts";

/** A minted token held for one organisation, project and signed-in user. */
export type PersonalTokenMint = {
  token: string | undefined;
  isMinting: boolean;
  /** What this token can do, for the banner. */
  scopeNote: string;
  /** Joins a mint already in flight; resolves undefined when the scope changed meanwhile. */
  mint: () => Promise<string | undefined>;
};

type Held = { scopeKey: string; token: string };
type InFlight = { scopeKey: string; promise: Promise<string | undefined> };

function heldTokenFor({ held, scopeKey }: { held: Held | undefined; scopeKey: string }) {
  return held?.scopeKey === scopeKey ? held.token : undefined;
}

function isStaleHeld({ held, scopeKey }: { held: Held | undefined; scopeKey: string }) {
  return held !== undefined && held.scopeKey !== scopeKey;
}

function joinableMint({ inFlight, scopeKey }: { inFlight: InFlight | undefined; scopeKey: string }) {
  return inFlight?.scopeKey === scopeKey ? inFlight.promise : undefined;
}

function settledInFlight({
  inFlight,
  promise,
}: {
  inFlight: InFlight | undefined;
  promise: Promise<string | undefined>;
}) {
  return inFlight?.promise === promise ? undefined : inFlight;
}

function settledMintingIn({ current, startedIn }: { current: string | undefined; startedIn: string }) {
  return current === startedIn ? undefined : current;
}

/**
 * Mints a personal access token on the project holding only `permissions` (ingestion, as a
 * CLI `login --project` key, by default), kept in this component's memory only: never
 * storage, the global store, a URL or the mutation cache. A scope change drops it.
 */
export function useMintPersonalToken({
  organizationId,
  projectId,
  userId,
  name,
  permissions = INGESTION_PERMISSIONS,
}: {
  organizationId: string | undefined;
  projectId: string | undefined;
  userId: string | undefined;
  name: string;
  permissions?: readonly TokenPermission[];
}): PersonalTokenMint {
  const { mutateAsync, reset } = apiKeyClient.apiKey.create.useMutation({ gcTime: 0 });
  const scopeKey = `${organizationId}|${projectId}|${userId}|${permissions.join(",")}`;
  const [held, setHeld] = useState<Held>();
  const [mintingIn, setMintingIn] = useState<string>();
  const inFlight = useRef<InFlight>(undefined);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  if (isStaleHeld({ held, scopeKey })) setHeld(undefined);

  function mint(): Promise<string | undefined> {
    if (!organizationId || !projectId) return Promise.resolve(undefined);
    const joined = joinableMint({ inFlight: inFlight.current, scopeKey });
    if (joined) return joined;
    const startedIn = scopeKey;
    const promise = mutateAsync(
      personalTokenInput({ organizationId, projectId, name, permissions }),
    )
      .then(({ token }) => {
        if (currentScope.current !== startedIn) return undefined;
        setHeld({ scopeKey: startedIn, token });
        return token;
      })
      .finally(() => {
        inFlight.current = settledInFlight({ inFlight: inFlight.current, promise });
        setMintingIn((current) => settledMintingIn({ current, startedIn }));
        reset();
      });
    inFlight.current = { scopeKey, promise };
    setMintingIn(scopeKey);
    return promise;
  }

  return {
    token: heldTokenFor({ held, scopeKey }),
    isMinting: mintingIn === scopeKey,
    scopeNote: tokenScopeNote({ permissions }),
    mint,
  };
}
