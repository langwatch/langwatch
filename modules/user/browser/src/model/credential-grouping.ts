import type {
  CliSessionCard,
  PersonalIngestionKeyListing,
} from "@langwatch/enterprise-governance-contract";

/** The ingestion keys under each signed-in device, and those under none. */
export type GroupedIngestionKeys = {
  keysBySession: Map<number, PersonalIngestionKeyListing[]>;
  orphanKeys: PersonalIngestionKeyListing[];
};

/**
 * Which card each key belongs on: a CLI-minted key carries its session's login
 * key id as `parentApiKeyId`. A key whose parent matches none of the live
 * sessions falls to the "Other keys" card rather than disappearing.
 */
export function groupKeysBySession({
  sessions,
  keys,
}: {
  sessions: Pick<CliSessionCard, "sessionStartedAtMs" | "cliApiKeyId">[];
  keys: PersonalIngestionKeyListing[];
}): GroupedIngestionKeys {
  const sessionByLoginKeyId = new Map<string, number>();
  for (const session of sessions) {
    if (session.cliApiKeyId !== null) {
      sessionByLoginKeyId.set(session.cliApiKeyId, session.sessionStartedAtMs);
    }
  }

  const keysBySession = new Map<number, PersonalIngestionKeyListing[]>();
  const orphanKeys: PersonalIngestionKeyListing[] = [];
  for (const key of keys) {
    const sessionStartedAtMs =
      key.parentApiKeyId === null ? void 0 : sessionByLoginKeyId.get(key.parentApiKeyId);
    if (sessionStartedAtMs === void 0) {
      orphanKeys.push(key);
      continue;
    }
    const bucket = keysBySession.get(sessionStartedAtMs) ?? [];
    bucket.push(key);
    keysBySession.set(sessionStartedAtMs, bucket);
  }
  return { keysBySession, orphanKeys };
}
