// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { deviceLabelForSession } from "@langwatch/api-key-contract";
import {
  IngestionKeySessionRevokedError,
  IngestionKeySourceNotAllowedError,
  IngestionKeyWorkspaceMissingError,
  PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";

import { findDeviceLabel } from "../rules/device-label.rules.ts";
import type { GovernanceCliCaller } from "./governance-cli-access.service.ts";
import type { GovernanceCliCredentialMembers } from "./governance-cli-credentials.service.ts";

const logger = createLogger("langwatch:governance-cli");

/** One project, as the two handout routes answer it. */
export type GovernanceCliProject = Readonly<{ id: string; slug: string; name: string }>;

export type GovernanceCliIngestionKeyOutcome =
  | Readonly<{
      outcome: "minted";
      token: string;
      prefix: string;
      endpoint: string;
      project?: GovernanceCliProject | undefined;
    }>
  | Readonly<{ outcome: "direct-otel-not-allowed"; toolSlug: string }>
  | Readonly<{ outcome: "project-not-found"; projectRef: string }>
  | Readonly<{ outcome: "personal-project-not-allowed" }>
  | Readonly<{ outcome: "forbidden" }>
  | Readonly<{ outcome: "source-type-not-personal"; sourceType: string }>
  | Readonly<{ outcome: "personal-workspace-missing" }>
  | Readonly<{ outcome: "session-signed-out" }>
  | Readonly<{ outcome: "failed" }>;

type GovernanceCliIngestionKeyMintMembers = Pick<
  GovernanceCliCredentialMembers,
  "ingestionKeys" | "aiTools" | "projects" | "permittedOnProject" | "publicBaseUrl"
>;

/** Mints the CLI's `ik-lw-` ingestion keys, into a named project or the caller's own workspace. */
export class GovernanceCliIngestionKeyMintService {
  private constructor(private readonly members: GovernanceCliIngestionKeyMintMembers) {}

  static create(
    members: GovernanceCliIngestionKeyMintMembers,
  ): GovernanceCliIngestionKeyMintService {
    return new GovernanceCliIngestionKeyMintService(members);
  }

  /**
   * A write-only `ik-lw-` key and its OTLP endpoint. Without a project ref the
   * caller's personal project is used; with one, that project — resolved
   * inside the caller's organization only.
   */
  async mintIngestionKey(input: {
    caller: GovernanceCliCaller;
    sourceType: string;
    projectRef: string | undefined;
    deviceLabel: string | undefined;
  }): Promise<GovernanceCliIngestionKeyOutcome> {
    const policed = await this.directOtelPolicy(input);

    if (policed) return policed;

    if (input.projectRef !== void 0) {
      return this.mintProjectIngestionKey({ ...input, projectRef: input.projectRef });
    }

    return this.mintPersonalIngestionKey(input);
  }

  /**
   * Apply the declared tool's direct-OTLP policy: a mint naming a tool the
   * organization turned off is refused, which catches an old CLI, a stale
   * cached policy, or a hand-run of the documented flow. Only source types a
   * wrapped tool stamps are governed; anything else has no per-tool policy.
   */
  private async directOtelPolicy(input: {
    caller: GovernanceCliCaller;
    sourceType: string;
  }): Promise<GovernanceCliIngestionKeyOutcome | null> {
    // `Object.hasOwn` rather than a plain lookup: the key is request-
    // controlled, so `"toString"` would otherwise resolve an inherited
    // function, pass a truthy check, and index the policy map with nothing.
    const toolSlug = Object.hasOwn(PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE, input.sourceType)
      ? PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE[input.sourceType]
      : void 0;

    if (!toolSlug) return null;

    const policy = await this.members.aiTools.resolveToolPolicy({
      organizationId: input.caller.organization_id,
      userId: input.caller.user_id,
      slug: toolSlug,
    });

    return policy.allowOtelDirect ? null : { outcome: "direct-otel-not-allowed", toolSlug };
  }

  /**
   * `projectRef` is read as an id first, then as a slug, and both lookups stay
   * inside the caller's organization: a project in another tenant reports the
   * same absence as one that does not exist. Membership does not authorize the
   * mint — the caller needs the very grant the minted key carries.
   */
  private async mintProjectIngestionKey(input: {
    caller: GovernanceCliCaller;
    projectRef: string;
    sourceType: string;
    deviceLabel: string | undefined;
  }): Promise<GovernanceCliIngestionKeyOutcome> {
    const [project] = await this.members.projects.findLiveByRef({
      projectRef: input.projectRef,
      organizationId: input.caller.organization_id,
    });

    if (!project) return { outcome: "project-not-found", projectRef: input.projectRef };

    if (project.isPersonal && project.ownerUserId !== input.caller.user_id) {
      return { outcome: "personal-project-not-allowed" };
    }

    const permitted = await this.members.permittedOnProject({
      userId: input.caller.user_id,
      projectId: project.id,
      permission: "traces:create",
    });

    if (!permitted) return { outcome: "forbidden" };

    try {
      const result = await this.members.ingestionKeys.issueForProject({
        callerUserId: input.caller.user_id,
        // A shared project's key is an org service key, owned by nobody, so it
        // stays visible to the whole team. The caller's own personal workspace
        // is the exception: only its owner may hold a key that reaches it.
        ownerUserId: project.isPersonal ? input.caller.user_id : null,
        organizationId: input.caller.organization_id,
        projectId: project.id,
        sourceType: input.sourceType,
        // The label lands inside the key's display name, so it goes through
        // the same reduction a virtual-key label does.
        createdByDeviceLabel: findDeviceLabel(
          input.deviceLabel ??
            input.caller.client_info?.device_label ??
            input.caller.client_info?.hostname ??
            void 0,
        ),
      });

      return {
        outcome: "minted",
        token: result.token,
        prefix: result.prefix,
        endpoint: this.otlpEndpoint(),
        project: { id: project.id, slug: project.slug, name: project.name },
      };
    } catch (err) {
      logger.error(
        { err, projectId: project.id, sourceType: input.sourceType },
        "[governance-cli] project ingestion-key mint failed",
      );

      return { outcome: "failed" };
    }
  }

  /**
   * The caller's own workspace, one key per device. Create-only, because the
   * other devices under this login are still exporting with theirs; the
   * key lives and dies with this device's session (its login key).
   */
  private async mintPersonalIngestionKey(input: {
    caller: GovernanceCliCaller;
    sourceType: string;
  }): Promise<GovernanceCliIngestionKeyOutcome> {
    try {
      const result = await this.members.ingestionKeys.mint({
        userId: input.caller.user_id,
        organizationId: input.caller.organization_id,
        sourceType: input.sourceType,
        fromCliSession: true,
        parentApiKeyId: input.caller.cli_api_key_id ?? null,
        // The same label the session's login key carries, so the devices tab
        // can put the key beside its session.
        createdByDeviceLabel: deviceLabelForSession(input.caller.client_info),
      });

      return {
        outcome: "minted",
        token: result.token,
        prefix: result.prefix,
        endpoint: this.otlpEndpoint(),
      };
    } catch (err) {
      // A source type no wrapped tool stamps and a missing workspace are the
      // two failures the caller can act on, so they are the only ones that
      // report as such. Everything else is a server fault.
      if (IngestionKeySourceNotAllowedError.is(err)) {
        return { outcome: "source-type-not-personal", sourceType: input.sourceType };
      }

      if (IngestionKeyWorkspaceMissingError.is(err)) {
        return { outcome: "personal-workspace-missing" };
      }

      if (IngestionKeySessionRevokedError.is(err)) {
        return { outcome: "session-signed-out" };
      }

      logger.error(
        { err, userId: input.caller.user_id, sourceType: input.sourceType },
        "[governance-cli] personal ingestion-key mint failed",
      );

      return { outcome: "failed" };
    }
  }

  /** The control-plane origin the CLI persists, and the OTLP endpoint's root. */
  private otlpEndpoint(): string {
    return `${(this.members.publicBaseUrl ?? "https://app.langwatch.ai").replace(/\/+$/, "")}/api/otel`;
  }
}
