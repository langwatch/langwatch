/**
 * Resolves the TLS-related environment for the spawned scenario runner.
 *
 * The runner is an isolated child process whose vendored `@langwatch/scenario`
 * SDK (the EventReporter that POSTs run events to the platform, and the
 * UserSimulatorAgent that calls the model API via the `ai` SDK) uses its OWN
 * fetch/undici stack. It does NOT share the app's `ssrfSafeFetch` TLS
 * relaxation, so under haven — where the platform is served over portless HTTPS
 * with a locally-trusted CA — the runner rejects the cert ("self-signed
 * certificate in certificate chain") on every platform and model call.
 *
 * Two mutually-exclusive fixes, preferred first:
 *
 *   1. Forward NODE_EXTRA_CA_CERTS. haven sets this on the app process (it
 *      points Node at the portless Local CA). The app's env whitelist for the
 *      child previously dropped it, so the child never trusted the CA — we now
 *      forward it. TLS verification stays ON, against a trusted CA. This is the
 *      correct fix and the only one that ever runs when a CA is present.
 *
 *   2. Fallback: disable TLS verification for the child (NODE_TLS_REJECT_UNAUTHORIZED=0),
 *      but ONLY in local, non-SaaS development. This is gated on the SAME signal
 *      the app's ssrfSafeFetch uses to relax TLS (IS_SAAS === false — see
 *      `~/utils/ssrfProtection.ts` `createSSRFSafeFetchConfig`) AND on
 *      NODE_ENV !== "production". Both must hold, so a hosted/SaaS deployment
 *      can NEVER reach this branch and can never ship a runner with TLS
 *      verification off.
 *
 * Kept as a pure function (no env reads inside) so the gating is explicit and
 * unit-testable; the caller passes the live signals in.
 *
 * @see specs/scenarios/scenario-infra-error-surfacing.feature
 */

export interface ChildTlsEnvInput {
  /** The app's IS_SAAS flag — true on the hosted product, false on-prem/local. */
  isSaaS: boolean;
  /** process.env.NODE_ENV of the parent app. */
  nodeEnv: string | undefined;
  /** process.env.NODE_EXTRA_CA_CERTS of the parent app (haven sets this). */
  nodeExtraCaCerts: string | undefined;
}

export interface ChildTlsEnv {
  NODE_EXTRA_CA_CERTS?: string;
  NODE_TLS_REJECT_UNAUTHORIZED?: string;
}

export function resolveChildTlsEnv(input: ChildTlsEnvInput): ChildTlsEnv {
  const { isSaaS, nodeEnv, nodeExtraCaCerts } = input;

  // Preferred: a trusted local CA is available — forward it, keep verification ON.
  if (nodeExtraCaCerts && nodeExtraCaCerts.trim().length > 0) {
    return { NODE_EXTRA_CA_CERTS: nodeExtraCaCerts };
  }

  // Fallback: local, non-SaaS dev ONLY. Never in production, never in SaaS.
  const isLocalDev = !isSaaS && nodeEnv !== "production";
  if (isLocalDev) {
    return { NODE_TLS_REJECT_UNAUTHORIZED: "0" };
  }

  // Hosted / SaaS / production: never relax TLS, never inject a CA override.
  return {};
}
