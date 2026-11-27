/**
 * Reading the CLI access bearers a device grant minted: each read checks that the
 * bearer's person still stands in the organization.
 * @see specs/ai-gateway/governance/cli-login.feature
 */

import {
  OrganizationInvalidCredentialsError,
  ProjectInvalidCredentialsError,
} from "@langwatch/api";
import { cliAccessTokenKey, type CliAccessSession } from "@langwatch/auth-contract";
import { HandledError } from "@langwatch/handled-error";

import type { CliAccessProject } from "../../../services/api-rest-credentials.service.ts";
import { isProjectGone } from "../rules/cli-device-flow.rules.ts";
import type { CliAccessTokenRecord } from "../rules/cli-device-session.rules.ts";
import type { CliDeviceFlowCollaborators } from "./cli-device-flow.service.ts";
import { CliDeviceSessionService } from "./cli-device-session.service.ts";

/** A CLI access session as its readers see it, never the token record itself. */
export type CliAccessSessionRead = CliAccessSession & Readonly<{ tokenKey: string }>;

/**
 * The record behind a presented access bearer, refused with `refusal` unless its person still
 * stands in the organization: a deactivation or a disabled or removed seat ends the bearer now,
 * not when its hour runs out.
 */
async function standingAccessRecord({
  flow,
  authorization,
  refusal,
}: {
  flow: CliDeviceFlowCollaborators;
  authorization: string;
  refusal: () => Error;
}): Promise<CliAccessTokenRecord> {
  const record = await flow
    .sessions()
    .getAccessToken(authorization)
    .catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "cli_session_record_not_found") {
        throw refusal();
      }
      throw error;
    });
  const standing = await flow.directory().hasActiveMembership({
    userId: record.user_id,
    organizationId: record.organization_id,
  });
  if (!standing) throw refusal();

  return record;
}

/** The caller facts behind an access bearer; anything else is `invalid_credentials`. */
async function accessSessionOf({
  flow,
  authorization,
}: {
  flow: CliDeviceFlowCollaborators;
  authorization: string;
}): Promise<CliAccessSessionRead> {
  const token = CliDeviceSessionService.extractBearerCliAccessToken(authorization);
  if (token === null) throw new OrganizationInvalidCredentialsError();
  const record = await standingAccessRecord({
    flow,
    authorization,
    refusal: () => new OrganizationInvalidCredentialsError(),
  });

  return {
    userId: record.user_id,
    organizationId: record.organization_id,
    ...(record.project_id ? { projectId: record.project_id } : {}),
    ...(record.project_locked ? { projectLocked: true } : {}),
    tokenKey: cliAccessTokenKey(token),
    ...(record.cli_api_key_id ? { cliApiKeyId: record.cli_api_key_id } : {}),
    ...(record.client_info
      ? {
          clientInfo: {
            deviceLabel: record.client_info.device_label,
            hostname: record.client_info.hostname,
          },
        }
      : {}),
  };
}

/**
 * The person and live project behind a bound access bearer; anything else is
 * `invalid_credentials`.
 */
async function accessProjectOf({
  flow,
  authorization,
}: {
  flow: CliDeviceFlowCollaborators;
  authorization: string;
}): Promise<CliAccessProject> {
  const record = await standingAccessRecord({
    flow,
    authorization,
    refusal: () => new ProjectInvalidCredentialsError(),
  });
  if (!record.project_id) throw new ProjectInvalidCredentialsError();

  const project = await flow
    .directory()
    .getLiveProject({ projectId: record.project_id, organizationId: record.organization_id })
    .catch((error: unknown) => {
      if (isProjectGone(error)) throw new ProjectInvalidCredentialsError();
      throw error;
    });

  return {
    userId: record.user_id,
    organizationId: record.organization_id,
    project: { ...project, organizationId: record.organization_id },
  };
}

/** The facts behind a presented CLI access bearer, for the doors that admit one. */
export class CliDeviceAccessService {
  static create({ flow }: { flow: CliDeviceFlowCollaborators }): CliDeviceAccessService {
    return new CliDeviceAccessService(flow);
  }

  private constructor(private readonly flow: CliDeviceFlowCollaborators) {}

  getAccessProject({ authorization }: { authorization: string }): Promise<CliAccessProject> {
    return accessProjectOf({ flow: this.flow, authorization });
  }

  getAccessSession({ authorization }: { authorization: string }): Promise<CliAccessSessionRead> {
    return accessSessionOf({ flow: this.flow, authorization });
  }
}
