Feature: AI Gateway — a model name routes by what the providers declare

  # Resolution lives in the Go gateway
  # (services/aigateway/adapters/modelresolver + services/aigateway/app),
  # so these scenarios bind to Go tests.

  As a developer calling the LangWatch AI Gateway
  I want the gateway to route a model name that a bound provider declares
  So that a model I can see in GET /v1/models is a model I can call

  Background:
    Given a virtual key whose bound providers declare their own models

  Rule: A slash in a model name is a provider prefix only when the first segment names one

    The gateway used to read every slash as a provider prefix. A custom
    provider that declared the model "stealth/ox-alpha" therefore resolved to
    a provider called "stealth", which no key can hold, and the request was
    refused for a provider the caller never named. The same key listed
    "stealth/ox-alpha" in GET /v1/models, so the gateway advertised a model it
    refused to route.

    The first segment is now a prefix only when it names a provider family the
    gateway knows, or a routing handle the organization set. Anything else is
    part of the model name.

    @unit
    Scenario: A declared model whose name contains a slash routes without a prefix
      Given a custom provider that declares the model "stealth/ox-alpha"
      When a request names model "stealth/ox-alpha"
      Then the request reaches the custom provider
      And the model sent upstream is "stealth/ox-alpha"

    @unit
    Scenario: A known family prefix keeps its meaning
      Given a key holding an OpenAI credential and a custom credential
      When a request names model "openai/gpt-5-mini"
      Then the request reaches the OpenAI provider
      And the model sent upstream is "gpt-5-mini"

    @unit
    Scenario: A custom prefix keeps every segment after it
      Given a custom provider that declares the model "stealth/ox-alpha"
      When a request names model "custom/stealth/ox-alpha"
      Then the request reaches the custom provider
      And the model sent upstream is "stealth/ox-alpha"

    @unit
    Scenario: A deployment name containing a slash is matched whole
      Given an Azure provider whose deployment map has the key "team/gpt-5-prod"
      When a request names model "team/gpt-5-prod"
      Then the request reaches the Azure provider

  Rule: A bare model name matches the provider that declares it

    A provider slot carries the models it serves: the models a customer
    declared on a custom provider, and for the hosted families the model
    catalog the platform ships. A bare model name is matched against those
    catalogs before anything is guessed, so a key holding OpenAI and Anthropic
    sends "gpt-5-mini" to OpenAI without a prefix.

    @unit
    Scenario: A catalog model name reaches the provider that serves it
      Given a key holding an OpenAI credential and an Anthropic credential
      When a request names model "gpt-5-mini"
      Then the request reaches the OpenAI provider

    @unit
    Scenario: A catalog match beats the model-name guess table
      Given a custom provider that declares the model "gpt-4o-clone"
      And the key holds no OpenAI credential
      When a request names model "gpt-4o-clone"
      Then the request reaches the custom provider

    @unit
    Scenario: Several providers declaring the same model keep the chain order
      Given two custom providers that both declare the model "shared-model"
      When a request names model "shared-model"
      Then the request reaches the first of the two in the key's chain order
      And the second stays in the chain as a failover target

    @unit
    Scenario: A model no catalog declares still uses the guess table
      Given a key holding an OpenAI credential and an Anthropic credential
      And no provider declares the model "gpt-brand-new"
      When a request names model "gpt-brand-new"
      Then the request reaches the OpenAI provider

  Rule: A key with one credential forwards a model it cannot place

    One credential is one door, so forwarding a model nobody declared is not a
    guess between vendors. It is what keeps a self-hosted proxy with an empty
    catalog usable.

    @unit
    Scenario: A single-credential key forwards an undeclared model
      Given a key whose only credential is a custom provider with no declared models
      When a request names model "some-private-build"
      Then the request reaches the custom provider
      And the model sent upstream is "some-private-build"

  Rule: A key with several credentials refuses a model it cannot place

    Sending an unplaceable model down a chain of several vendors makes each
    one answer for a model it never had, and the caller reads the last
    vendor's error instead of the real problem. The gateway refuses instead,
    and the refusal lists the prefixes this key accepts.

    @unit
    Scenario: An unplaceable model on a multi-credential key is refused
      Given a key holding an OpenAI credential and an Anthropic credential
      And no provider declares the model "private-build"
      When a request names model "private-build"
      Then the request is refused with code "model_not_recognized"
      And the refusal states the caller can fix it
      And the refusal names the provider families the key can reach

    @unit
    Scenario: The refusal lists a bounded number of options
      Given a key holding more provider instances than the refusal can list
      When a request names a model no provider declares
      Then the refusal names at most ten options
      And it says that more exist

  Rule: An alias target is read with the same vocabulary as a request

    An alias is written by the key's owner and read by the resolver. Before
    this, an alias target whose first segment was not a provider family became
    a request for a provider nobody holds, so an alias to a declared custom
    model was a guaranteed refusal.

    @unit
    Scenario: An alias to a whole model id resolves to that model
      Given a custom provider that declares the model "stealth/ox-alpha"
      And the key aliases "fast" to "stealth/ox-alpha"
      When a request names model "fast"
      Then the model sent upstream is "stealth/ox-alpha"
      And no provider called "stealth" is looked for
