Feature: Record-time cost enrichment

  A customer can price a model themselves: a regex, a set of per-token rates,
  saved against a project, a team or an organization. When a span names a model
  one of those rules matches, the rates are stamped onto the span BEFORE the
  event is made immutable, so the fold projection prices the span from the
  customer's own numbers rather than the platform catalog's.

  Everything in this feature fails silently in one direction. A span enriched
  from the wrong rule, from the platform catalog, or from no rule at all is
  stored with a cost attribute that no reader can tell apart from a correct
  one, and the only place the mistake ever surfaces is a bill.

  @unit
  Scenario: A matched rule stamps both token rates
    Given a project with a cost rule matching the span's model
    When the span is enriched
    Then the input and output rates are stamped under the fold's own attribute keys

  @unit
  Scenario: A rule that leaves a cache rate unset stamps no cache rate
    Given a cost rule that sets a cache-read rate and no other cache rate
    When the span is enriched
    Then only the cache-read rate is stamped
    And the unset cache rates fall back to the input rate at fold time rather than being priced at zero

  @unit
  Scenario: Every cache rate the rule defines is stamped
    Given a cost rule that sets all three cache rates
    When the span is enriched
    Then all three are stamped alongside the token rates

  @unit
  Scenario: A rule with only one token rate stamps the other as zero
    Given a cost rule that sets an output rate and no input rate
    When the span is enriched
    Then the input rate is stamped as zero

  @unit
  Scenario: The request model wins over the response model
    Given a span carrying both a request model and a response model
    When the span is enriched
    Then the rule matching the requested model prices it
    And token estimation still reads the response model first, because a span is tokenized as the model that ran and priced as the model that was asked for

  @unit
  Scenario: The four generic model keys are read in order
    Given a span carrying a model under each of the four generic keys
    When the span is enriched
    Then the request model is read first, then the response model, then the LLM model name, then the AI model

  @unit
  Scenario: A coding-agent span may name its model under a bare `model`
    Given a Claude Code request span or a Codex turn span whose only model attribute is `model`
    When the span is enriched
    Then the rule matching that model prices it

  @unit
  Scenario: A generic span's bare `model` never activates a cost rule
    Given any other span whose only model attribute is `model`
    When the span is enriched
    Then no rate is stamped
    And the project's cost rules are never read

  @unit
  Scenario: A span with no model never reads the catalog
    Given a span with no model attribute at all
    When the span is enriched
    Then the project's cost rules are never read

  @unit
  Scenario: The matcher falls back in a fixed order
    Given a cost rule written against the canonical form of a model name
    When a span names the model in a raw, cased, provider-prefixed, subtyped, Bedrock-enveloped or quantized form
    Then the same rule prices it

  @unit
  Scenario: The raw name is tried against every rule before any transformed name is tried against any rule
    Given one rule matching only the subtype-stripped name and one matching the raw name
    When the span is enriched
    Then the rule matching the raw name prices it

  @unit
  Scenario: A rule whose regex can backtrack catastrophically never matches
    Given a cost rule whose pattern is unsafe
    When the span is enriched
    Then the unsafe rule is skipped and a safe rule may still price the span

  @unit
  Scenario: An unmatched model is left unpriced
    Given a project whose rules match no part of the span's model name
    When the span is enriched
    Then no rate is stamped

  @unit
  Scenario: The catalog is read for the ingesting project
    Given a span ingested for a project
    When the span is enriched
    Then the project's own rules are the ones read

  @unit
  Scenario: Record-time cost enrichment composes from the catalog port alone
    Given a process holding a published model-provider service
    When the record-time enrichment graph is composed
    Then it answers the narrow port the record command names

  @unit
  Scenario: The composed path prices a span from the operator's own rules
    Given the composed enrichment graph
    When a span is enriched through the port
    Then the operator's rates reach the span

  @unit
  Scenario: An organization-scoped rule prices a project's spans
    Given a cost rule saved against the organization rather than the project
    When a span of one of its projects is enriched
    Then the rule prices it

  @unit
  Scenario: A project with no rules leaves the span unpriced
    Given a project with no cost rules
    When a span is enriched through the port
    Then the span carries no cost attributes
