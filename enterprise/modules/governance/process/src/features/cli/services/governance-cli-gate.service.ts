// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  GovernanceCliRefusalAnswer,
  GovernanceCliRequest,
} from "@langwatch/enterprise-governance-contract";

import { refuse } from "../rules/governance-cli-answer.rules.ts";
import type {
  GovernanceCliAccessApi,
  GovernanceCliAdmission,
  GovernanceCliCaller,
} from "./governance-cli-access.service.ts";

type GovernanceCliGateRefusal = Extract<GovernanceCliRefusalAnswer, { status: 403 }>;

type GovernanceCliAdmitInput = GovernanceCliRequest &
  Readonly<{ requireActiveMembership?: boolean }>;

/** The seat check every CLI route walks after the door: admit the caller or answer the refusal. */
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
  }
}
