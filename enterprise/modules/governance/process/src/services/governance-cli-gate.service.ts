// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuthzPermission } from "@langwatch/authorization";
import {
  governanceCliRefusalAnswers,
  type GovernanceCliRefusalAnswer,
  type GovernanceCliRequest,
} from "@langwatch/enterprise-governance-contract";

import { refuse } from "../rules/governance-cli-answer.rules.ts";
import type {
  GovernanceCliAccessApi,
  GovernanceCliAdmission,
  GovernanceCliCaller,
  GovernanceCliEnterpriseFeature,
} from "./governance-cli-access.service.ts";

export type GovernanceCliGateRefusal = Extract<GovernanceCliRefusalAnswer, { status: 402 | 403 }>;

export type GovernanceCliAdmitInput = GovernanceCliRequest &
  Readonly<{
    feature?: GovernanceCliEnterpriseFeature;
    permission?: AuthzPermission;
    requireActiveMembership?: boolean;
  }>;

/** The door every CLI route walks first: admit the caller or answer the refusal. */
export class GovernanceCliGateService {
  #access: GovernanceCliAccessApi;

  private constructor(access: GovernanceCliAccessApi) {
    this.#access = access;
  }

  static create({ access }: { access: GovernanceCliAccessApi }): GovernanceCliGateService {
    return new GovernanceCliGateService(access);
  }

  async admit(
    input: GovernanceCliAdmitInput,
  ): Promise<{ caller: GovernanceCliCaller } | { refusal: GovernanceCliGateRefusal }> {
    return admissionResult(await this.#access.admit(input));
  }
}

function admissionResult(
  result: GovernanceCliAdmission,
): { caller: GovernanceCliCaller } | { refusal: GovernanceCliGateRefusal } {
  switch (result.outcome) {
    case "admitted":
      return { caller: result.caller };
    case "membership-ended":
      return {
        refusal: refuse(
          "forbidden",
          "Your access to this organization has ended. Run `langwatch login` to sign in again.",
          403,
        ),
      };
    case "payment-required":
      return {
        refusal: {
          status: 402,
          body: governanceCliRefusalAnswers[402].parse({
            error: "payment_required",
            error_description: result.errorMessage,
            upgrade_url: result.upgradeUrl,
          }),
        },
      };
    case "forbidden":
      return {
        refusal: refuse(
          "forbidden",
          `Missing required permission '${result.permission}' on this organization`,
          403,
        ),
      };
  }
}
