Feature: Latest-alias model resolution

  A role default can be stored as a virtual alias, "latest" or
  "latest-mini", instead of a pinned model id. The alias resolves to the
  provider's current top tier at read time, so an organization's default
  follows new model releases without anyone rewriting config.

  "latest" means the provider's flagship: the tier they position as the
  most capable general-purpose chat model. "latest-mini" means their fast,
  cost-efficient tier, the one meant for high-volume latency-sensitive
  work.

  Rule: The alias follows the flagship even when a generation renames its tiers

    Through GPT-5.5, OpenAI's flagship was the unsuffixed model of a
    generation and the fast tier carried a "-mini" suffix. GPT-5.6 ships
    named tiers instead, Sol as flagship, Terra as the balanced middle,
    and Luna as the fast tier, with no unsuffixed model at all. A picker
    that only recognises the older naming sees nothing in GPT-5.6 and
    silently keeps offering the previous generation.

    @unit
    Scenario: Latest picks the flagship tier of the newest generation
      Given the catalog carries GPT-5.5 and the GPT-5.6 tiers
      When the OpenAI "latest" alias is resolved
      Then it resolves to GPT-5.6 Sol
      And it does not resolve to GPT-5.5

    @unit
    Scenario: Latest-mini picks the fast tier of the newest generation
      Given the catalog carries GPT-5.4 Mini and the GPT-5.6 tiers
      When the OpenAI "latest-mini" alias is resolved
      Then it resolves to GPT-5.6 Luna
      And it does not resolve to GPT-5.4 Mini

    @unit
    Scenario: The balanced middle tier is never an alias target
      Given the catalog carries GPT-5.6 Sol, Terra and Luna
      When either OpenAI alias is resolved
      Then neither resolves to GPT-5.6 Terra
      # Terra sits between the flagship and fast tiers, so it answers
      # neither question the aliases ask. It stays explicitly selectable.

    @unit
    Scenario: Older naming still resolves when no newer generation exists
      Given the catalog carries only generations up to GPT-5.5
      When the OpenAI aliases are resolved
      Then "latest" resolves to GPT-5.5
      And "latest-mini" resolves to GPT-5.5 Mini

  Rule: Higher-effort serving modes are not alias targets

    A "-pro" model is the same underlying model served at higher
    reasoning effort. Picking it as an org-wide default would raise cost
    and latency for every assistive call, so aliases skip it the same way
    they skip the nano tier.

    @unit
    Scenario: Pro serving modes are skipped
      Given the catalog carries GPT-5.6 Sol and GPT-5.6 Sol Pro
      When the OpenAI "latest" alias is resolved
      Then it resolves to GPT-5.6 Sol
      And it does not resolve to GPT-5.6 Sol Pro

  Rule: Ties inside one generation resolve by tier, not by catalog order

    @unit
    Scenario: A generation shipping both an unsuffixed model and a named flagship
      Given a future generation carries both an unsuffixed model and a named flagship tier
      When the OpenAI flagship tier is picked
      Then the named flagship tier wins
      # Without an explicit tier ranking the two sort equal and the
      # winner falls out of catalog iteration order.

  Rule: Every read-time boundary hands a provider the concrete model

    The pickers resolve an alias before they store a default, but the
    prompts API, the CLI and agent-written configs store the alias
    verbatim. No provider knows the word "latest", so the last stop before
    the wire resolves it. A concrete model id passes through unchanged.

    @unit
    Scenario: The LiteLLM params carry the concrete model for an alias
      Given a project with the OpenAI provider enabled
      When LiteLLM params are prepared for the model "openai/latest-mini"
      Then the params name the model the alias currently resolves to
      And they do not name "latest-mini"

    @unit
    Scenario: A concrete model id is not rewritten
      When LiteLLM params are prepared for the model "openai/gpt-5-mini"
      Then the params name "openai/gpt-5-mini"

    @unit
    Scenario: An explicit alias handed to the model factory resolves before the provider lookup
      Given a project with the OpenAI provider enabled
      When a Vercel AI model is requested for the explicit model "openai/latest"
      Then the LiteLLM params are prepared for the model the alias resolves to
      And the provider is read from the resolved model
