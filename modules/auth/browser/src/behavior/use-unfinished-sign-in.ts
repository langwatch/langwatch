import { unfinishedSignInSchema, type UnfinishedSignIn } from "@langwatch/auth-contract";
import { useEffect, useState } from "react";

/** The door's read of a sign-in this browser started that never came back. */
const UNFINISHED_SIGN_IN_URL = "/api/auth/sign-in/unfinished";

type Unfinished = NonNullable<UnfinishedSignIn["unfinished"]>;

/**
 * A sign-in this browser left for a provider that never sent it back, asked once per mount.
 * A failed read is no notice: the page works the same without it.
 */
export function useUnfinishedSignIn({ enabled }: { enabled: boolean }): Unfinished | null {
  const [unfinished, setUnfinished] = useState<Unfinished | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void readUnfinishedSignIn().then((answer) => {
      if (current) setUnfinished(answer);
    });
    return () => {
      current = false;
    };
  }, [enabled]);

  return unfinished;
}

async function readUnfinishedSignIn(): Promise<Unfinished | null> {
  try {
    const response = await fetch(UNFINISHED_SIGN_IN_URL, { credentials: "include" });
    if (!response.ok) return null;
    return unfinishedSignInSchema.parse(await response.json()).unfinished;
  } catch {
    return null;
  }
}
