export class ModelProviderNotFoundError extends Error {
  readonly code = "model_provider_not_found";
  constructor(message = "Model provider not found") { super(message); }
}
export class ModelProviderInvalidError extends Error {
  readonly code = "model_provider_invalid";
  constructor(message = "Invalid model provider") { super(message); }
}
export class ModelProviderScopesRequiredError extends Error { readonly code = "model_provider_scopes_required"; }
export class ModelDefaultNotFoundError extends Error { readonly code = "model_default_not_found"; }
export class ModelCostNotFoundError extends Error { readonly code = "model_cost_not_found"; }
