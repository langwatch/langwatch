// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { moduleApi } from "@langwatch/kernel/module-api";
import type {
  SuggestTierTargetsInput,
  TierTargetSuggestion,
} from "@langwatch/model-provider-contract";

import type {
  EnsureDefaultPersonalVirtualKeyInput,
  IssuedPersonalVirtualKey,
  IssuedPersonalVirtualKeyAnswer,
  IssuePersonalVirtualKeyInput,
  ListPersonalVirtualKeysInput,
  PersonalVirtualKey,
} from "./personal-virtual-key.ts";
import type {
  CreateRoutingPolicyInput,
  DeleteRoutingPolicyInput,
  FindRoutingPolicyInput,
  ListRoutingPoliciesInput,
  RoutingPolicy,
  SetDefaultRoutingPolicyInput,
  UpdateRoutingPolicyInput,
} from "./routing-policy.ts";

/** Routing policies and personal gateway keys: the Enterprise half of the AI Gateway. */
export interface EnterpriseGatewayApi {
  /** Policies in an organization, optionally narrowed to one scope's choices. */
  listRoutingPolicies(input: ListRoutingPoliciesInput): Promise<RoutingPolicy[]>;
  getRoutingPolicy(input: FindRoutingPolicyInput): Promise<RoutingPolicy>;
  /** How many policies an organization holds (governance's setup checklist). */
  countRoutingPolicies(input: { organizationId: string }): Promise<number>;
  routingPolicyTierSuggestions(
    input: Omit<SuggestTierTargetsInput, "limit">,
  ): TierTargetSuggestion[];
  createRoutingPolicy(input: CreateRoutingPolicyInput): Promise<RoutingPolicy>;
  updateRoutingPolicy(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy>;
  setDefaultRoutingPolicy(input: SetDefaultRoutingPolicyInput): Promise<RoutingPolicy>;
  deleteRoutingPolicy(input: DeleteRoutingPolicyInput): Promise<void>;
  /** The actor's own personal keys, or anyone's under `virtualKeys:viewOtherPersonal`. */
  listPersonalVirtualKeys(input: {
    organizationId: string;
    targetUserId?: string;
    actorUserId: string;
  }): Promise<PersonalVirtualKey[]>;
  /** Mints one of the actor's own personal keys; the secret answers exactly once. */
  issuePersonalVirtualKey(input: {
    organizationId: string;
    label: string;
    routingPolicyId?: string;
    actorUserId: string;
  }): Promise<IssuedPersonalVirtualKeyAnswer>;
  revokePersonalVirtualKey(input: {
    organizationId: string;
    id: string;
    actorUserId: string;
  }): Promise<void>;
  /** The CLI's reads and mints, unguarded: the governance CLI door admits the caller first. */
  personalVirtualKeyList(input: ListPersonalVirtualKeysInput): Promise<PersonalVirtualKey[]>;
  personalVirtualKeyEnsureDefault(
    input: EnsureDefaultPersonalVirtualKeyInput,
  ): Promise<IssuedPersonalVirtualKey>;
  personalVirtualKeyIssue(input: IssuePersonalVirtualKeyInput): Promise<IssuedPersonalVirtualKey>;
}

export const EnterpriseGatewayApi = moduleApi<EnterpriseGatewayApi>()("enterprise-gateway");
