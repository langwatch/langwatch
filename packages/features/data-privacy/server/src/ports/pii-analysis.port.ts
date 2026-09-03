/**
 * The external PII analysis capability, as this feature asks for it.
 *
 * Harvested from the application's `PiiRedactionTransport` interface in
 * `platform/app/src/server/tracer/collector/piiCheck.ts`. It is a port rather
 * than an interface here because a process composes it: the application builds
 * a Google DLP client and a Presidio HTTP client inside its own runtime, and a
 * worker composed from packages builds its own. Neither belongs to this
 * feature — one of them drags a gRPC channel and a generated proto tree — so
 * what this feature names is the capability, not either client.
 *
 * `close` is on the port because the DLP client holds a gRPC channel: a
 * composition root that builds one has to be able to give it back, and the
 * only handle it has is this port.
 *
 * `tryClearGoogleDlp` carries the `try` prefix the application's
 * `clearGoogleDlp` does not, because `null` here MEANS something — the service
 * found nothing and the caller must keep the text it already had — and this
 * repository's `fallible-result-naming` policy wants a method that can answer
 * with absence to say so in its name. It is a rename at one seam, not a change
 * of contract: the null still means exactly what it means in the application.
 */

import type { PIIRedactionLevel } from "@langwatch/trace-contract";

/** Process-owned external PII analysis capability. */
export abstract class PiiAnalysisPort {
  abstract tryClearGoogleDlp(input: {
    text: string;
    piiRedactionLevel: PIIRedactionLevel;
    exceptPatterns?: readonly string[];
  }): Promise<string | null>;
  abstract clearPresidio(
    texts: string[],
    piiRedactionLevel: PIIRedactionLevel,
    entities?: readonly string[],
  ): Promise<(string | null)[]>;
  abstract close(): Promise<void>;
}

export type PIICheckOptions = {
  piiRedactionLevel: PIIRedactionLevel;
  enforced?: boolean;
  mainMethod?: "google_dlp" | "presidio";
  /**
   * Explicit analyzer entity names (uppercase, e.g. "PERSON") to detect,
   * overriding the level's default set. The custom PII level uses this to scan
   * only the analysis-service identifiers a team selected.
   */
  entities?: readonly string[];
  /**
   * The policy's do-not-redact exception patterns (raw source strings). Only
   * `batchClearPII`'s google_dlp branch actually reads this: DLP
   * findings carry the matched text, so a finding fully covered by an
   * exception can be vetoed before masking (see the DLP half of whichever
   * adapter answers this port).
   * `mainMethod: "presidio"` — the one every strict/custom analysis-service
   * call currently uses — ignores this field entirely: Presidio's batch
   * endpoint returns pre-anonymized text with no positions or matched text to
   * veto against. This is why a resolved policy with exceptions narrows the
   * Presidio call to just the strict-only entities (names, locations) instead
   * of trying to pass exceptions through it (see `tryLambdaAfterNative` in
   * `services/otlp-span-pii-redaction.service.ts`) — narrowing shrinks WHICH
   * entities are exposed to the gap, it does not close it. A name/location match is never
   * protected by an exception; only entities the native pass handles are
   * (locked in by the application's
   * span-pii-redaction.nativeScopedPolicy.test.ts "strict-only exception
   * scoping" tests, and by this package's own strict-only scoping test).
   */
  exceptPatterns?: readonly string[];
};
