Feature: Latest-alias model resolution

  A role default can be stored as a virtual alias, "latest" or
  "latest-mini", instead of a pinned model id. The alias resolves to the
  newest model of a provider's tier at read time, so an organization's
  default follows new model releases without anyone rewriting config.

  "latest" means the provider's main tier: the newest general-purpose
  model of the line they position for everyday serious work, not the
  premium-priced top tier (GPT-6 Astra, GPT-5.6 Sol, Claude Fable, Gemini
  Pro) and not the small one. "latest-mini" means their fast,
  cost-efficient tier, the one meant for high-volume latency-sensitive
  work. The same ranking is what a provider card recommends, so the pick
  the card pre-fills is the model the org seed writes.

  Rule: The alias follows the main tier even when a generation renames its tiers

    Through GPT-5.5, OpenAI's general-purpose model was the unsuffixed
    model of a generation and the fast tier carried a "-mini" suffix.
    GPT-5.6 ships named tiers instead, Sol on top, Terra as the balanced
    middle, and Luna as the fast tier, with no unsuffixed model at all.
    GPT-6 ships Astra on top, Sol as the middle and Luna as the fast tier,
    so the same name can be the top tier of one generation and the main
    tier of the next. A picker that only recognises the older naming sees
    nothing in GPT-5.6 and silently keeps offering the previous generation.

    @unit
    Scenario: Latest picks the main tier of the newest generation
      Given the catalog carries GPT-5.5 and the GPT-5.6 tiers
      When the OpenAI "latest" alias is resolved
      Then it resolves to GPT-5.6 Terra
      And it does not resolve to GPT-5.5

    @unit
    Scenario: Latest-mini picks the fast tier of the newest generation
      Given the catalog carries GPT-5.4 Mini and the GPT-5.6 tiers
      When the OpenAI "latest-mini" alias is resolved
      Then it resolves to GPT-5.6 Luna
      And it does not resolve to GPT-5.4 Mini

    @unit
    Scenario: The top tier is never an alias target
      Given the catalog carries GPT-6 Astra, GPT-5.6 Sol, Terra and Luna
      When either OpenAI alias is resolved
      Then neither resolves to GPT-6 Astra or GPT-5.6 Sol
      # The top tier is the premium-priced one. Picking it as an org-wide
      # default would raise cost for every assistive call. It stays
      # explicitly selectable.

    @unit
    Scenario: A named tier's role follows its generation's lineup
      Given the catalog carries GPT-5.6 Sol and Terra, and GPT-6 Astra and Sol
      When the OpenAI main tier is ranked
      Then GPT-6 Sol comes first and GPT-5.6 Terra second
      And neither GPT-5.6 Sol nor GPT-6 Astra ranks
      # The main tier is the second rung a generation ships, counted from
      # the top of the Astra, Sol, Terra ladder. Luna is always the fast tier.

    @unit
    Scenario: A generation shipping only its top tier has no main tier yet
      Given the catalog carries the GPT-5.6 tiers and GPT-6 Astra only
      When the OpenAI main tier is ranked
      Then it is GPT-5.6 Terra

    @unit
    Scenario: Older naming still resolves when no newer generation exists
      Given the catalog carries only generations up to GPT-5.5
      When the OpenAI aliases are resolved
      Then "latest" resolves to GPT-5.5
      And "latest-mini" resolves to GPT-5.5 Mini

  Rule: Higher-effort serving modes and batch lanes are not alias targets

    A "-pro" model is the same underlying model served at higher
    reasoning effort. Picking it as an org-wide default would raise cost
    and latency for every assistive call, so aliases skip it the same way
    they skip the nano tier. A ":batch" id is the same model on the
    asynchronous lane, never a default for a live call.

    @unit
    Scenario: Pro serving modes are skipped
      Given the catalog carries GPT-5.6 Terra, GPT-5.6 Terra Pro and the Terra batch lane
      When the OpenAI "latest" alias is resolved
      Then it resolves to GPT-5.6 Terra
      And it does not resolve to the pro serving mode or the batch lane

  Rule: Ties inside one generation resolve by tier, not by catalog order

    @unit
    Scenario: A generation shipping both an unsuffixed model and a named main tier
      Given a future generation carries both an unsuffixed model and a named main tier
      When the OpenAI main tier is picked
      Then the named main tier wins
      # Without an explicit tier ranking the two sort equal and the
      # winner falls out of catalog iteration order.

  Rule: Every provider's grammar reads its own tiers

    Each provider names its tiers differently and, OpenAI's named tiers
    aside, the ranking reads the id alone: Anthropic's Opus is the main tier and Sonnet the fast one,
    with Fable above and Haiku below; Gemini's Flash is the main tier and
    Flash Lite the fast one, with Pro above; DeepSeek's V4 Pro is the main
    tier and V4 Flash the fast one. Dated snapshots, experimental builds,
    image and vision variants never fit a grammar, so they never win.

    @unit
    Scenario: Anthropic latest is the newest Opus, never Fable
      Given the catalog carries Claude Opus 4.8, Claude Opus 5 and Claude Fable 5.1
      When the Anthropic "latest" alias is resolved
      Then it resolves to Claude Opus 5

    @unit
    Scenario: A generation without a minor version outranks the previous generation
      Given the catalog carries Claude Opus 4.8 and Claude Opus 5
      When the Anthropic main tier is ranked
      Then Claude Opus 5 comes first
      # A generation's first release carries no minor in its id.

    @unit
    Scenario: Fable and Haiku are never alias targets
      Given the catalog carries Claude Fable 5.1, Claude Haiku 4.5 and the Opus batch lane
      When either Anthropic alias is resolved
      Then none of them ranks

    @unit
    Scenario: Gemini latest is the newest Flash, never Pro
      Given the catalog carries Gemini 3.1 Pro Preview, Gemini 3.8 Flash and Gemini 3.5 Flash Lite
      When the Gemini "latest" alias is resolved
      Then it resolves to Gemini 3.8 Flash
      And "latest-mini" resolves to Gemini 3.5 Flash Lite

    @unit
    Scenario: Gemini Pro and the image variants are never alias targets
      Given the catalog carries Gemini Pro, the Flash image variants and Gemma
      When either Gemini alias is resolved
      Then none of them ranks

    @unit
    Scenario: DeepSeek recommends V4 Pro through the same ranking
      Given the catalog carries DeepSeek V3.2, V4 Pro, V4 Flash and the dated V4 Pro snapshot
      When DeepSeek's recommendation is read
      Then it is DeepSeek V4 Pro
      # DeepSeek has no alias; the provider card reads the same ranking.

    @unit
    Scenario: Dated, experimental and vision variants never win
      Given the catalog carries the dated V4 Pro snapshot, V3.2 Exp, V4 Flash Vision Exp and R1
      When the DeepSeek tiers are ranked
      Then none of them ranks

  Rule: The recommendation tracks the committed catalog

    The catalog is synced weekly. The recommendation is derived from it,
    never typed, so a sync that lands a newer main-tier model moves the
    recommendation on its own, and a pick that is not the newest main-tier
    model fails the pin.

    @unit
    Scenario: The recommendation is the newest main-tier model of each provider
      Given the committed catalog
      When the recommendation is read for OpenAI, Anthropic, Gemini and DeepSeek
      Then it is GPT-6 Sol, Claude Opus 5.5, Gemini 3.8 Flash and DeepSeek V4 Pro
      And each is a chat model the catalog carries

    @unit
    Scenario: The recommendation is never the top tier, a serving mode or a batch lane
      Given the committed catalog
      When the recommendation is read for every tiered provider
      Then it is not Astra, GPT-5.6 Sol, Fable, Gemini Pro, a dated snapshot, an experimental build or a batch lane

    @unit
    Scenario: The latest alias and the recommendation are the same pick
      Given the committed catalog
      When "latest" is resolved for OpenAI, Anthropic and Gemini
      Then each resolves to that provider's recommendation

    @unit
    Scenario: Latest-mini resolves to the fast tier of each provider
      Given the committed catalog
      When "latest-mini" is resolved for OpenAI, Anthropic and Gemini
      Then it is GPT-6 Luna, Claude Sonnet 5 and Gemini 3.5 Flash Lite

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
