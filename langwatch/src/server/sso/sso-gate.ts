import { env } from "~/env.mjs";
import { prisma } from "~/server/db";
import {
  isExpired,
  parseLicenseKey,
  verifySignature,
} from "../../../ee/licensing/validation";
import { createLogger } from "../../utils/logger/server";
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
 * (Decision 1). Skips soft-deleted orgs — see `sso-license.repository.ts`
 * for why that's currently a no-op (no such column exists on `Organization`
 * yet). Lets DB errors propagate so the memoization wrapper can evict
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
 * Composes the DB/env-dependent half of the gate (everything except the
 * `IS_SAAS` short-circuit, which must never touch the DB at all —
 * MINOR-4 / the "IS_SAAS never touches DB" invariant).
 */
async function computeGate(): Promise<boolean> {
  if (hasSignedInstanceLicense(env.LANGWATCH_LICENSE_KEY)) return true;
  return anyOrgHasSignedLicense();
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
 * `resolveAuthProvider()` — `env.NEXTAUTH_PROVIDER`, coerced to `"email"`
 * when the gate denies, so the sign-in page renders the email form and
 * never auto-redirects to a disabled IdP.
 */
export async function resolveAuthProvider(): Promise<string> {
  if (env.NEXTAUTH_PROVIDER === "email") return "email";
  const allowed = await platformSSOAllowed();
  return allowed ? env.NEXTAUTH_PROVIDER : "email";
}
