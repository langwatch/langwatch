/**
 * An activation code set as the configured license.
 *
 * `LANGWATCH_LICENSE_KEY` (Helm `app.license.key`) takes a signed license key
 * or an activation code, told apart by shape ({@link detectLicenseInputForm}).
 * A signed key is used as it is. A code is redeemed through the same call the
 * License page makes, and the license it returns is stored on the oldest
 * organization, so the install ends up exactly where a UI activation leaves it.
 *
 * It runs before the server listens, so the SSO gate already sees the license
 * on the first request. It never throws:
 * a refused or unreachable redemption is logged with its reason and the app
 * boots without the license. An install that already holds a valid license
 * does not redeem again, which makes every later boot a no-op.
 *
 * @see specs/licensing/configured-license-forms.feature
 */

import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import { prisma } from "~/server/db";
import { getLicenseHandler } from "~/server/subscriptionHandler";
import { invalidateSsoGate } from "../../sso/sso-gate";
import { readConnectConfig } from "../connect/install/connectConfig";
import { getConnectLicenseClient } from "../connect/install/connectLicenseClient";
import { installInstanceId } from "../connect/install/instanceIdentity";
import { detectLicenseInputForm } from "../licenseInputForm";
import { validateLicense } from "../validation";

const defaultLogger = createLogger("langwatch:licensing:configured-license");

/** A redemption at boot gives up well before the transport's own timeout. */
const BOOT_REDEMPTION_TIMEOUT_MS = 15_000;

export type ConfiguredActivationOutcome =
  | { outcome: "not_configured" }
  | { outcome: "license_key" }
  | { outcome: "already_licensed"; organizationId: string }
  | { outcome: "no_organization" }
  | { outcome: "connect_disabled" }
  | { outcome: "activated"; organizationId: string }
  | { outcome: "refused"; code: string }
  | { outcome: "license_rejected"; error: string };

interface ActivationLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface ConfiguredActivationDependencies {
  /** The configured value, `LANGWATCH_LICENSE_KEY`. */
  value: string | null | undefined;
  /** Whether connect is turned on (`LANGWATCH_CONNECT_DISABLED` unset). */
  connectPermitted: boolean;
  /** Every organization with its stored license, oldest first. */
  findOrganizations(): Promise<{ id: string; license: string | null }[]>;
  instanceId(): Promise<string>;
  /** Redeems the code at the connect host; throws on refusal. */
  activate(input: { code: string; instanceId: string }): Promise<{
    license: string;
  }>;
  /** Validates and stores the license on the organization. */
  store(input: {
    organizationId: string;
    license: string;
  }): Promise<{ success: true } | { success: false; error: string }>;
  /** Whether a stored license is signed by LangWatch and inside its term. */
  isValidLicense(license: string): boolean;
  logger: ActivationLogger;
}

/** The code's last four characters, enough to tell two codes apart in a log. */
function hintOf(code: string): string {
  return code.slice(-4);
}

function refusalCodeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return "connect_unreachable";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function activateConfiguredLicense(
  deps: ConfiguredActivationDependencies,
): Promise<ConfiguredActivationOutcome> {
  const input = detectLicenseInputForm(deps.value);
  if (input.form === "empty") return { outcome: "not_configured" };
  if (input.form === "license_key") {
    deps.logger.info(
      { source: "LANGWATCH_LICENSE_KEY", form: "license_key" },
      "LANGWATCH_LICENSE_KEY holds a signed license key; it is used as is and needs no outbound access",
    );
    return { outcome: "license_key" };
  }
  return redeemConfiguredCode({ deps, code: input.code });
}

type LogContext = {
  source: string;
  form: "activation_code";
  codeHint: string;
};

async function findLicensed(deps: ConfiguredActivationDependencies) {
  const organizations = await deps.findOrganizations();
  const licensed = organizations.find(
    (organization) =>
      !!organization.license && deps.isValidLicense(organization.license),
  );
  return { organizations, licensed };
}

async function redeemConfiguredCode({
  deps,
  code,
}: {
  deps: ConfiguredActivationDependencies;
  code: string;
}): Promise<ConfiguredActivationOutcome> {
  const { logger } = deps;
  const context: LogContext = {
    source: "LANGWATCH_LICENSE_KEY",
    form: "activation_code",
    codeHint: hintOf(code),
  };

  const { organizations, licensed } = await findLicensed(deps);
  if (licensed) {
    logger.info(
      { ...context, organizationId: licensed.id },
      "LANGWATCH_LICENSE_KEY holds an activation code; this install already holds a valid license, so the code is not redeemed again",
    );
    return { outcome: "already_licensed", organizationId: licensed.id };
  }

  const target = organizations[0];
  if (!target) {
    logger.info(
      context,
      "LANGWATCH_LICENSE_KEY holds an activation code; there is no organization yet, so it is redeemed when the first organization is created",
    );
    return { outcome: "no_organization" };
  }

  if (!deps.connectPermitted) {
    logger.warn(
      context,
      "LANGWATCH_LICENSE_KEY holds an activation code, but LANGWATCH_CONNECT_DISABLED is set, so it cannot be redeemed; set LANGWATCH_LICENSE_KEY to the signed license key instead",
    );
    return { outcome: "connect_disabled" };
  }

  let license: string;
  try {
    const instanceId = await deps.instanceId();
    ({ license } = await deps.activate({ code, instanceId }));
  } catch (error) {
    return explainRefusal({ deps, context, error });
  }

  return storeRedeemedLicense({
    deps,
    context,
    organizationId: target.id,
    license,
  });
}

async function explainRefusal({
  deps,
  context,
  error,
}: {
  deps: ConfiguredActivationDependencies;
  context: LogContext;
  error: unknown;
}): Promise<ConfiguredActivationOutcome> {
  const code = refusalCodeOf(error);
  // Two replicas booting together redeem the same code, and the one that
  // loses is told it was already used. The winner has stored the license by
  // then, so that is the same install, not a refusal.
  if (code === "activation_code_already_redeemed") {
    const { licensed } = await findLicensed(deps);
    if (licensed) {
      deps.logger.info(
        { ...context, organizationId: licensed.id },
        "LANGWATCH_LICENSE_KEY holds an activation code; another process of this install redeemed it and stored the license",
      );
      return { outcome: "already_licensed", organizationId: licensed.id };
    }
  }
  deps.logger.warn(
    { ...context, code, reason: messageOf(error) },
    `LANGWATCH_LICENSE_KEY holds an activation code; redeeming it at connect.langwatch.ai failed (${code}), so the app starts without a license`,
  );
  return { outcome: "refused", code };
}

async function storeRedeemedLicense({
  deps,
  context,
  organizationId,
  license,
}: {
  deps: ConfiguredActivationDependencies;
  context: LogContext;
  organizationId: string;
  license: string;
}): Promise<ConfiguredActivationOutcome> {
  const stored = await deps.store({ organizationId, license });
  if (!stored.success) {
    deps.logger.warn(
      { ...context, organizationId, error: stored.error },
      "LANGWATCH_LICENSE_KEY holds an activation code; the license it was exchanged for did not validate, so it was not stored",
    );
    return { outcome: "license_rejected", error: stored.error };
  }
  deps.logger.info(
    { ...context, organizationId },
    "LANGWATCH_LICENSE_KEY holds an activation code; redeemed it and stored the license on the organization",
  );
  return { outcome: "activated", organizationId };
}

/**
 * {@link activateConfiguredLicense} against this install's database and
 * connect host. Self-hosted only: LangWatch Cloud never redeems a code for
 * itself.
 */
export async function activateConfiguredLicenseForInstall(): Promise<ConfiguredActivationOutcome> {
  if (env.IS_SAAS) return { outcome: "not_configured" };
  const config = readConnectConfig();
  try {
    return await activateConfiguredLicense({
      value: env.LANGWATCH_LICENSE_KEY,
      connectPermitted: config.permitted,
      findOrganizations: () =>
        prisma.organization.findMany({
          select: { id: true, license: true },
          orderBy: { createdAt: "asc" },
        }),
      instanceId: () => installInstanceId(prisma),
      activate: ({ code, instanceId }) =>
        getConnectLicenseClient(config.licenseEndpoint).activate({
          code,
          instanceId,
          signal: AbortSignal.timeout(BOOT_REDEMPTION_TIMEOUT_MS),
        }),
      store: async ({ organizationId, license }) => {
        const result = await getLicenseHandler().validateAndStoreLicense(
          organizationId,
          license,
        );
        if (!result.success) return { success: false, error: result.error };
        // A redemption on first organization creation happens on a running
        // server, so the gate has to read the new license now.
        invalidateSsoGate();
        return { success: true };
      },
      isValidLicense: (license) =>
        validateLicense({ licenseKey: license }).valid,
      logger: defaultLogger,
    });
  } catch (error) {
    defaultLogger.warn(
      { err: error },
      "Could not check the configured license; the app starts without redeeming it",
    );
    return { outcome: "not_configured" };
  }
}
