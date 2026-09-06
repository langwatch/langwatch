/**
 * The instance-provisioning family authenticates against the INSTANCE, not an
 * organization, so it takes the instance administrator credential rather than
 * the organization API key every other command resolves. Falling back to
 * `LANGWATCH_API_KEY` would send an organization key to a surface that cannot
 * accept one and read as a plain 401.
 */
import {
  INSTANCE_ADMIN_KEY_ENV,
  OrganizationsAdminApiService,
} from "@/client-sdk/services/organizations-admin/organizations-admin-api.service";
import {
  commandValidationError,
  reportCommandError,
} from "../../utils/errorOutput";

/** The instance credential from the flag or the environment, or a refusal. */
export const requireInstanceKey = (fromFlag?: string): string => {
  const instanceKey = fromFlag ?? process.env[INSTANCE_ADMIN_KEY_ENV];
  if (!instanceKey) {
    reportCommandError({
      error: commandValidationError(
        `No instance administrator credential. Pass --instance-key, or set ${INSTANCE_ADMIN_KEY_ENV}. This surface exists on self-hosted deployments only.`,
      ),
    });
    process.exit(1);
  }
  return instanceKey;
};

export const instanceAdminService = (
  instanceKey: string,
): OrganizationsAdminApiService =>
  new OrganizationsAdminApiService({ instanceKey });
