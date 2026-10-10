// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { HandledError } from "@langwatch/handled-error";

export class PersonalVirtualKeyLabelTakenError extends HandledError {
  declare readonly code: "personal_virtual_key_label_taken";

  constructor(label: string) {
    super("personal_virtual_key_label_taken", "A personal key with this label already exists", {
      httpStatus: 409,
      meta: { label },
    });
    this.name = "PersonalVirtualKeyLabelTakenError";
  }
}

export class NoEligibleModelProvidersError extends HandledError {
  declare readonly code: "no_eligible_model_providers";

  constructor(organizationId: string) {
    super("no_eligible_model_providers", "The organization has no usable model provider", {
      httpStatus: 409,
      meta: { organizationId },
    });
    this.name = "NoEligibleModelProvidersError";
  }
}

export class RoutingPolicyEmptyError extends HandledError {
  declare readonly code: "routing_policy_has_no_providers";

  constructor(routingPolicyId: string, routingPolicyName: string) {
    super("routing_policy_has_no_providers", "That routing policy has no providers on it", {
      httpStatus: 422,
      meta: { routingPolicyId, routingPolicyName },
    });
    this.name = "RoutingPolicyEmptyError";
  }
}

export class PersonalVirtualKeyMissingError extends HandledError {
  declare readonly code: "virtual_key_not_found";

  constructor(virtualKeyId: string) {
    super("virtual_key_not_found", "Personal virtual key not found", {
      httpStatus: 404,
      meta: { virtualKeyId },
    });
    this.name = "PersonalVirtualKeyMissingError";
  }
}

export class RoutingPolicyProviderRequiredError extends HandledError {
  declare readonly code: "routing_policy_must_have_provider";

  constructor() {
    super("routing_policy_must_have_provider", "A routing policy needs at least one provider", {
      httpStatus: 422,
    });
    this.name = "RoutingPolicyProviderRequiredError";
  }
}

export class RoutingPolicyScopeRequiredError extends HandledError {
  declare readonly code: "routing_policy_must_have_scope";

  constructor() {
    super("routing_policy_must_have_scope", "A routing policy needs at least one scope", {
      httpStatus: 422,
    });
    this.name = "RoutingPolicyScopeRequiredError";
  }
}

export class RoutingPolicyModelNotConcreteError extends HandledError {
  declare readonly code: "routing_policy_model_must_be_concrete";

  constructor(field: string, value: string) {
    super(
      "routing_policy_model_must_be_concrete",
      "That model name does not point at one specific model",
      { httpStatus: 422, meta: { field, value } },
    );
    this.name = "RoutingPolicyModelNotConcreteError";
  }
}
