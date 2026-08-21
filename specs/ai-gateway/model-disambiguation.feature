Feature: AI Gateway — which provider a model name reaches when a key has several

  # All scenarios in this file describe gateway model-resolution behaviour.
  # Implemented in the Go gateway service
  # (services/aigateway/adapters/modelresolver + services/aigateway/app), so
  # the scenarios bind to Go tests.

  As a developer calling the LangWatch AI Gateway with a multi-provider virtual key
  I want a model name to reach one provider by a rule I can read
  So that I never have to guess which provider served my request

  # This file described a "model_ambiguous" 400 that was never built. The
  # product went the other way: a name resolves through one ordered rule, the
  # order is stated, and a name that matches more than one instance is
  # disambiguated by a routing handle rather than by a refusal. The catalog and
  # handle behaviour live in model-routing-catalog.feature and
  # instance-routing-handle.feature; what stays here is the order itself and
  # what a caller is told.

  Rule: One ordered rule decides the provider

    The resolver reads a model name in a fixed order, and the first step that
    matches wins. Anything else would make the answer depend on which check
    happened to run first.

    @unit
    Scenario: The resolution order is alias, then handle, then family, then catalog, then guess
      Given a key whose providers declare models and hold routing handles
      When a request names a model
      Then the key's own alias is applied first
      And a first segment naming a routing handle pins that provider instance
      And a first segment naming a provider family selects that family
      And the whole name is matched against the providers' declared models
      And only then is the provider guessed from the model-name table

    @unit
    Scenario: An alias is applied before anything else is read
      Given the key aliases "gpt-5-mini" to "openai/gpt-5-mini"
      When a request names model "gpt-5-mini"
      Then the alias decides the provider
      And no catalog is consulted

  Rule: A name matching several instances follows the key's chain order

    A provider family names a kind, not an instance, so "anthropic/..." on a
    key with two Anthropic instances matches both. The gateway does not
    refuse: it takes the key's own chain order, which is the routing policy
    order when the key has one, then the global fallback priority, then the
    creation date. Failover then walks the rest of the matches.

    @unit
    Scenario: The first matching instance in chain order serves the request
      Given two Anthropic providers bound to one key
      When a request names model "anthropic/claude-sonnet-5"
      Then the first of the two in chain order serves the request
      And the second remains available for failover

    @unit
    Scenario: A routing handle overrides the chain order
      Given two Anthropic providers bound to one key, the second with handle "eu"
      When a request names model "eu/claude-sonnet-5"
      Then the second provider serves the request

  Rule: A refusal names what this key can reach

    An earlier note here said the gateway must not enumerate the providers a
    key holds, to avoid disclosing tenant structure. That reasoning does not
    apply: the caller already holds the virtual key, and GET /v1/models on the
    same key already lists its models. Withholding the list only left the
    caller with a refusal they could not act on.

    @unit
    Scenario: A family prefix with no credential names the reachable families
      Given a key holding OpenAI and Anthropic credentials and no Bedrock credential
      When a request names model "bedrock/claude-3-haiku"
      Then the request is refused with code "model_provider_not_bound"
      And the refusal names the provider families the key can reach
      And it names the routing handles the key can reach

    @unit
    Scenario: The refusal states the caller can fix it
      When a request names a provider family the key does not hold
      Then the refusal is attributed to the caller

  # ============================================================================
  # models_allowed and aliases
  # ============================================================================

  Rule: An alias never reaches a model the key is not allowed to use

    An alias is a convenience for naming a model, not a second door into
    models_allowed. Resolution used to return the alias target before any
    allowlist check ran, so naming a forbidden model in an alias was enough
    to reach it, while the documentation promised the opposite.

    The allowlist judges what the alias resolved to, in either spelling: an
    operator who allowed "openai/gpt-5-mini" and one who allowed "gpt-5-mini"
    allowed the same model, and neither should have to guess which form the
    resolver will hand the check.

    @unit
    Scenario: An alias resolving outside models_allowed is refused
      Given a virtual key allowing only "claude-*"
      And the key aliases "coding" to "openai/gpt-5-mini"
      When a request names model "coding"
      Then the request is refused as model not allowed
      And the rejection names the model the alias resolved to
      And no call is made to any provider

    @unit
    Scenario: An alias resolving inside models_allowed is served
      Given a virtual key allowing only "claude-*"
      And the key aliases "coding" to "anthropic/claude-haiku-4-5"
      When a request names model "coding"
      Then the request resolves to "claude-haiku-4-5" on provider "anthropic"

    @unit
    Scenario: The allowlist accepts either spelling of the same model
      Given a virtual key allowing only "openai/gpt-5-mini"
      And the key aliases "coding" to "openai/gpt-5-mini"
      When a request names model "coding"
      Then the request resolves to "gpt-5-mini" on provider "openai"
      And a key allowing the bare "gpt-5-mini" resolves the same alias

    @unit
    Scenario: A key with no allowlist keeps serving every alias it defines
      Given a virtual key with no models_allowed
      And the key aliases "coding" to "openai/gpt-5-mini"
      When a request names model "coding"
      Then the request resolves to "gpt-5-mini" on provider "openai"

  Rule: A model refusal says who can fix it, and names what was refused

    Every model the gateway turns away is the caller's to fix: they can send
    a different name, or ask an admin to widen the key. A refusal that does
    not say so leaves the caller reading it as a fault on our side, and the
    same refusal has to read the same way however the name was written.

    A key can allow a model under one provider and not another, so a refusal
    that drops the provider half describes a rule the caller did not hit.

    @unit
    Scenario: Every model refusal names the caller as the fault
      Given a virtual key allowing only "openai/gpt-5.6-sol"
      When a request names a model the key does not allow
      Then the request is refused as model not allowed
      And the refusal states the caller can fix it
      And it does so whether the name came from an alias, a provider prefix, or a bare model

    @unit
    Scenario: A refused provider-qualified model is named the way it was sent
      Given a virtual key allowing only "openai/gpt-4"
      When a request names model "anthropic/gpt-4"
      Then the request is refused as model not allowed
      And the refusal names "anthropic/gpt-4" rather than the model half alone

  Rule: A named vendor is a rule, and a bare model name is a hint

    A model name with a provider prefix, or an alias the key owner wrote,
    states which vendor gets the request. If the key holds no credential for
    that vendor the request fails and says which slot is missing. It never
    goes to a different vendor.

    A bare model name states no vendor. The gateway guesses one from a short
    prefix table, and the guess is wrong in ways that matter: a key whose
    only credential is Azure serves "gpt-4o" from Azure, and a key whose
    only credential is Bedrock serves "claude-sonnet-4-5" from Bedrock. So a
    guess that matches no credential leaves the chain alone, and each
    credential then answers for its own vendor with its own error.

    @unit
    Scenario: A bare model name whose guessed vendor is absent still uses the key
      Given a key whose only credential is Azure
      When a request names the bare model "gpt-4o"
      Then the Azure credential serves it
