// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import { prisma } from "~/server/db";
import {
  isExpired,
  parseLicenseKey,
  verifySignature,
} from "../licensing/validation";
import { buildGenericOAuthConfigs, buildSocialProviders } from "./providers";
import {
  type ISsoLicenseRepository,
  SsoLicenseRepository,
} from "./sso-license.repository";

const logger = createLogger("langwatch:sso:gate");

/**
 * ADR-027: Single source of truth for the license-gated SSO decision.
 *
 * `platformSSOAllowed()` = `IS_SAAS || hasSignedInstanceLicense(LANGWATCH_LICENSE_KEY)
 * || anyOrgHasSignedLicense()`. "Signed" means `verifySignature()` passes —
 * expiry is deliberately ignored (Decision 1, v6: "once a customer, never
 * blocked"). Never use `validateLicense()` (strict expiry) or the
 * denormalized `licenseExpiresAt` column for this gate; those stay reserved
 * for plan-limit enforcement (`ee/licensing/licenseHandler.ts`).
 *
 * The gate is decided once per process (Decision 3, "startup semantics"):
 * the underlying computation is memoized, but ONLY on successful resolution
 * (resolved `true` or `false` from a completed scan). A thrown DB error is
 * never cached — the memo is evicted on rejection so the next request
 * retries and self-heals as soon as the DB answers (Decision 6).
 */

const defaultRepository = new SsoLicenseRepository(prisma);

// Test-only override seam — the public API intentionally takes no
// parameters (matches the ADR Schema section), so DI for repository-failure
// scenarios goes through this module-level seam instead of a function arg.
let repositoryOverride: ISsoLicenseRepository | null = null;

export function __setSsoLicenseRepositoryForTests(
  repository: ISsoLicenseRepository | null,
): void {
  repositoryOverride = repository;
}

const getRepository = (): ISsoLicenseRepository =>
  repositoryOverride ?? defaultRepository;

// Memoized once-per-process gate promise. Reset only by
// `__resetSsoGateForTests()` (test-only — production has no reset, matching
// "frozen until restart" semantics).
let memoizedGate: Promise<boolean> | null = null;

export function __resetSsoGateForTests(): void {
  memoizedGate = null;
  repositoryOverride = null;
}

/**
 * Inspects a single candidate license string: parses, verifies its
 * signature, and logs the outcome (Decision 8b — without per-candidate
 * logging, a mis-parsed old license is indistinguishable from "no license").
 * Returns the parsed license data when the signature verifies, otherwise
 * `null`.
 */
function inspectCandidateLicense(
  licenseKey: string,
  context: { source: "instance" | "organization"; organizationId?: string },
): { expiresAt: string; organizationName: string } | null {
  const parsed = parseLicenseKey(licenseKey);
  if (!parsed) {
    logger.warn(
      { ...context },
      "Inspected a license candidate: could not be parsed (invalid format)",
    );
    return null;
  }

  const signatureOk = verifySignature(parsed);
  logger.info(
    { ...context, signatureOk },
    signatureOk
      ? "Inspected a license candidate: signature ok"
      : "Inspected a license candidate: signature failed",
  );

  if (!signatureOk) return null;

  return {
    expiresAt: parsed.data.expiresAt,
    organizationName: parsed.data.organizationName,
  };
}

/**
 * The renewal-nudge log (Decision 8c): when SSO is granted by a
 * signature-valid but expired license, warn gently — this never affects the
 * gate's boolean result (expiry is deliberately ignored, Decision 1).
 */
function warnIfExpired(
  license: { expiresAt: string; organizationName: string },
  context: { source: "instance" | "organization"; organizationId?: string },
): void {
  if (isExpired(license.expiresAt)) {
    logger.warn(
      {
        ...context,
        organizationName: license.organizationName,
        expiresAt: license.expiresAt,
      },
      "SSO granted by an expired (but signature-valid) license — renewal reminder",
    );
  }
}

/**
 * Checks the `LANGWATCH_LICENSE_KEY` env var (instance-level entitlement,
 * Decision 5) — no DB required.
 */
function hasSignedInstanceLicense(licenseKey: string | undefined): boolean {
  if (!licenseKey) return false;
  const license = inspectCandidateLicense(licenseKey, { source: "instance" });
  if (!license) return false;
  warnIfExpired(license, { source: "instance" });
  return true;
}

/**
 * Scans organization license rows for at least one signature-valid license
 * (Decision 1). Lets DB errors propagate so the memoization wrapper can evict
 * instead of caching a false negative (Decision 6).
 */
async function anyOrgHasSignedLicense(): Promise<boolean> {
  const candidates = await getRepository().findOrganizationsWithLicense();

  for (const org of candidates) {
    const license = inspectCandidateLicense(org.license, {
      source: "organization",
      organizationId: org.id,
    });
    if (license) {
      warnIfExpired(license, {
        source: "organization",
        organizationId: org.id,
      });
      return true;
    }
  }
  return false;
}

/**
 * Ceiling on the licensing-store scan. A store that is slow rather than
 * broken would otherwise hold the first SSO request open indefinitely, since
 * nothing downstream of the gate imposes a deadline of its own. Timing out
 * lands on the same "deny for now, retry on the next request" path a hard DB
 * error already takes, so a store that recovers self-heals without a restart.
 */
const GATE_EVALUATION_TIMEOUT_MS = 5_000;

class SsoGateTimeoutError extends Error {
  constructor() {
    super(
      `SSO gate evaluation exceeded ${GATE_EVALUATION_TIMEOUT_MS}ms; treating the licensing store as unreachable`,
    );
    this.name = "SsoGateTimeoutError";
  }
}

/**
 * Composes the DB/env-dependent half of the gate (everything except the
 * `IS_SAAS` short-circuit, which must never touch the DB at all —
 * MINOR-4 / the "IS_SAAS never touches DB" invariant).
 */
async function computeGate(): Promise<boolean> {
  if (hasSignedInstanceLicense(env.LANGWATCH_LICENSE_KEY)) return true;

  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      anyOrgHasSignedLicense(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new SsoGateTimeoutError()),
          GATE_EVALUATION_TIMEOUT_MS,
        );
        // The losing leg of a Promise.race keeps running; without unref a
        // pending timer would hold the event loop open past the answer.
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * `platformSSOAllowed()` — see module docblock. `IS_SAAS` is checked BEFORE
 * anything else and before the memoized promise is ever touched, so a SaaS
 * deployment never performs a DB read for this gate (Decision 1, MINOR-4).
 */
export async function platformSSOAllowed(): Promise<boolean> {
  if (env.IS_SAAS) return true;

  if (!memoizedGate) {
    memoizedGate = computeGate()
      .then((allowed) => {
        // Logged once, at gate resolution (Decision 8a) — not per request
        // (that's the separate per-blocked-request log, Decision 8d, which
        // lives at the hook call site where the request path is known).
        if (!allowed && env.NEXTAUTH_PROVIDER !== "email") {
          logger.warn(
            {},
            "SSO is configured but no genuine license was found — starting in email mode; " +
              "set LANGWATCH_LICENSE_KEY or activate an organization license to enable SSO",
          );
        }
        return allowed;
      })
      .catch((err) => {
        // Evict on reject (Decision 6): the next call recomputes from
        // scratch instead of freezing a DB-blip denial for the rest of the
        // process.
        memoizedGate = null;
        throw err;
      });
  }

  try {
    return await memoizedGate;
  } catch (err) {
    logger.warn(
      { err },
      "SSO gate evaluation failed (licensing store unreachable) — denying SSO for this request; will retry on the next request",
    );
    return false;
  }
}

/**
 * Did the configured provider actually get wired into BetterAuth?
 *
 * Both builders only ever produce an entry for `NEXTAUTH_PROVIDER`, so
 * "produced nothing" means the deployment named a provider that this build
 * cannot mount — an id it does not know (`azureAd` for `azure-ad`, or one
 * that was never implemented), or a known id whose client credentials are
 * missing.
 */
function authProviderIsMounted(): boolean {
  return (
    Object.keys(buildSocialProviders(env)).length > 0 ||
    buildGenericOAuthConfigs(env).length > 0
  );
}

/**
 * `resolveAuthProvider()` — `env.NEXTAUTH_PROVIDER`, coerced to `"email"`
 * when the gate denies, so the sign-in page renders the email form and
 * never auto-redirects to a disabled IdP.
 *
 * It also coerces when the provider is allowed but nothing was mounted for
 * it. Returning the configured name there would point the sign-in page at an
 * IdP BetterAuth never registered, and a licensed deployment has no email
 * form to fall back to, so a single typo in `NEXTAUTH_PROVIDER` locks every
 * user out of an install that is paying for SSO. Email mode is the degraded
 * state, not the broken one: it stays signable-in while the operator reads
 * the log line and fixes the value.
 */
export async function resolveAuthProvider(): Promise<string> {
  if (env.NEXTAUTH_PROVIDER === "email") return "email";

  const allowed = await platformSSOAllowed();
  if (!allowed) return "email";

  if (!authProviderIsMounted()) {
    logger.warn(
      { provider: env.NEXTAUTH_PROVIDER },
      "NEXTAUTH_PROVIDER names a provider this deployment cannot mount — " +
        "starting in email mode; check the provider id against the " +
        "self-hosting SSO docs and that its client credentials are set",
    );
    return "email";
  }

  return env.NEXTAUTH_PROVIDER;
}
