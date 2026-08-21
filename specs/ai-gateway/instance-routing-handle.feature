Feature: AI Gateway — a routing handle names one provider instance

  As an administrator with more than one instance of the same provider
  I want to give an instance its own name in a model string
  So that a request reaches the instance I mean instead of whichever one the chain reaches first

  # A provider family prefix names a KIND of provider. With two Anthropic
  # instances bound to one key, "anthropic/claude-sonnet-5" matches both and
  # the chain order decides, which nothing in the product used to state. A
  # routing handle is the missing name: it is set on one ModelProvider row,
  # it is unique inside the organization, and it pins that exact row.

  Rule: A handle is a slug the organization owns

    @integration
    Scenario: A handle is stored lowercased
      Given an administrator sets the routing handle "MyRouter" on a provider
      Then the stored handle is "myrouter"

    @integration
    Scenario: A handle outside the allowed characters is refused
      When an administrator sets the routing handle "my router!"
      Then the write is refused as a validation error
      And the refusal states which characters a handle accepts

    @integration
    Scenario: A handle longer than the limit is refused
      When an administrator sets a routing handle of 33 characters
      Then the write is refused as a validation error

    @integration
    Scenario: A handle that names a provider family is refused
      When an administrator sets the routing handle "anthropic"
      Then the write is refused as a validation error
      And the refusal states that the name already means a provider family

    @integration
    Scenario: A handle that names a provider family alias is refused
      When an administrator sets the routing handle "vertex_ai"
      Then the write is refused as a validation error

    @integration
    Scenario: Two providers in one organization cannot share a handle
      Given a provider in organization "acme" already uses the handle "eu"
      When an administrator sets the handle "eu" on a second provider of "acme"
      Then the write is refused as a conflict
      And the refusal states the handle is already in use

    @integration
    Scenario: Two organizations can use the same handle
      Given a provider in organization "acme" uses the handle "eu"
      When an administrator sets the handle "eu" on a provider of another organization
      Then the write succeeds

    @integration
    Scenario: Clearing a handle releases the name
      Given a provider uses the handle "eu"
      When an administrator clears the handle
      Then the stored handle is empty
      And another provider of the same organization can take "eu"

  Rule: A handle pins the instance a request reaches

    @unit
    Scenario: A handle prefix reaches its own instance
      Given two Anthropic providers on one key, the second with handle "eu"
      When a request names model "eu/claude-sonnet-5"
      Then the request reaches the second Anthropic provider
      And the model sent upstream is "claude-sonnet-5"

    @unit
    Scenario: The family prefix still reaches the chain in order
      Given two Anthropic providers on one key, the second with handle "eu"
      When a request names model "anthropic/claude-sonnet-5"
      Then the request reaches the first Anthropic provider

    @unit
    Scenario: A handle is read before the family table
      Given a provider with handle "gemini-eu"
      When a request names model "gemini-eu/gemini-3.7-flash"
      Then the request reaches the provider holding the handle

    @unit
    Scenario: An alias can target a handle
      Given a provider with handle "eu"
      And the key aliases "fast" to "eu/claude-haiku-4-5"
      When a request names model "fast"
      Then the request reaches the provider holding the handle

    @unit
    Scenario: A handle of a provider the routing policy dropped names the policy
      Given a provider with handle "eu" that the key's routing policy excludes
      When a request names model "eu/claude-sonnet-5"
      Then the request is refused
      And the refusal states that the key's routing policy excludes the provider

    @unit
    Scenario: A handle of a provider outside the key's provider access names the access list
      Given a provider with handle "eu" outside the key's provider access
      When a request names model "eu/claude-sonnet-5"
      Then the request is refused
      And the refusal states that the provider is not in the key's provider access

    @unit
    Scenario: A handle no provider on the key holds is refused with the reachable options
      Given a key holding one Anthropic provider with no handle
      When a request names model "eu/claude-sonnet-5"
      Then the request is refused
      And the refusal names the provider families the key can reach

  Rule: Renaming a handle stops the old spelling

    A handle is part of a caller's request. Changing it is a breaking change
    for that caller, so the write is audited and the gateway config is
    evicted in the same transaction as the write.

    @integration
    Scenario: A renamed handle no longer resolves under its old name
      Given a provider with handle "eu" reached as "eu/claude-sonnet-5"
      When an administrator renames the handle to "europe"
      Then the gateway configuration is evicted
      And the change is recorded in the audit log

  Rule: The gateway config carries the handle

    @unit
    Scenario: A provider slot carries its handle to the gateway
      Given a provider with handle "eu"
      When the gateway configuration is materialised
      Then the provider slot carries the handle "eu"

    @unit
    Scenario: An excluded provider carries its handle too
      Given a provider with handle "eu" that the key's routing policy excludes
      When the gateway configuration is materialised
      Then the exclusion entry carries the handle "eu"

    @unit
    Scenario: A provider with no handle carries none
      Given a provider with no routing handle
      When the gateway configuration is materialised
      Then the provider slot carries no handle
