/**
 * Instance-provisioning commands authenticate against the INSTANCE, not an
 * org, so they take the instance admin credential, not `LANGWATCH_API_KEY`
 * -- an org key here would hit a surface that can't accept it and read as a 401.
 */
import {
  INSTANCE_ADMIN_KEY_ENV,
  OrganizationsAdminApiService,
} from "@/client-sdk/services/organizations-admin/organizations-admin-api.service";

import { commandValidationError, reportCommandError } from "../../utils/errorOutput";

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

export const instanceAdminService = (instanceKey: string): OrganizationsAdminApiService =>
  new OrganizationsAdminApiService({ instanceKey });
