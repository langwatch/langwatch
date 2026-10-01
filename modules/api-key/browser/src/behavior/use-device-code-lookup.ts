/** The device code the CLI printed, looked up once the reader has a session. */

import { useEffect, useState } from "react";

import type {
  ApiKeyHostApi,
  ApiKeySessionStatus,
  CliCredentialType,
  CliDeviceCodeLookup,
} from "../model/api-key-host.ts";

export type DeviceCodeLookupState =
  | { kind: "loading" }
  | {
      kind: "ready";
      userCode: string;
      status: string;
      expiresAt: number;
      credentialType: CliCredentialType;
      management: boolean;
    }
  | { kind: "error"; message: string }
  | { kind: "expired" };

function lookupStateFrom({
  result,
  userCode,
}: {
  result: CliDeviceCodeLookup;
  userCode: string;
}): DeviceCodeLookupState {
  switch (result.outcome) {
    case "expired":
      return { kind: "expired" };
    case "unknown":
      return {
        kind: "error",
        message: `Code "${userCode}" was not recognised. It may have expired or already been used.`,
      };
    case "failed":
      return { kind: "error", message: result.message };
    case "pending":
      return {
        kind: "ready",
        userCode: result.userCode,
        status: result.status,
        expiresAt: result.expiresAt,
        credentialType: result.credentialType,
        management: result.management,
      };
  }
}

/** Starts over for every new code: the previous lookup belongs to the old one. */
export function useDeviceCodeLookup({
  host,
  sessionStatus,
  userCode,
}: {
  host: ApiKeyHostApi;
  sessionStatus: ApiKeySessionStatus;
  userCode: string;
}): DeviceCodeLookupState {
  const [lookup, setLookup] = useState<DeviceCodeLookupState>({ kind: "loading" });

  useEffect(() => {
    setLookup({ kind: "loading" });
  }, [userCode]);

  useEffect(() => {
    if (sessionStatus !== "authenticated" || !userCode) return;
    let cancelled = false;
    void (async () => {
      const result = await host.lookupDeviceCode(userCode);
      if (!cancelled) setLookup(lookupStateFrom({ result, userCode }));
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, userCode, host]);

  return lookup;
}
