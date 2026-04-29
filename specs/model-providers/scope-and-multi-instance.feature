Feature: Model Provider Scope and Multi-Instance
  As an operator of a multi-tenant LangWatch deployment
  I want a model provider row to span multiple projects/teams/orgs and co-exist with other rows of the same provider type
  So that I can run one shared credential across many projects while still isolating production/experimentation keys when needed

  # Scope has TWO axes:
  #   1. Multi-select across the org/team/project hierarchy (one MP row can cover
  #      N scope entries; see ModelProviderScope join table below).
  #   2. Multi-instance per provider type ("OpenAI" + "OpenAI Production"
  #      + "OpenAI Experimental") each with their own scope set.
  #
  # Wire format for model IDs (see data-model below):
  #   - Canonical: "{modelProviderId}/{modelName}" — e.g. "mp_abc123/gpt-5"
  #   - Legacy: "{provider}/{modelName}" — e.g. "openai/gpt-5". Accepted at
  #     read-time when exactly one accessible MP has that provider string.
  #     Errors clearly when 0 or >1 candidates match ("ambiguous provider").

  Background:
    Given I am logged in
    And I belong to organization "acme" with team "platform" and project "web-app"
    And the model providers registry exposes "openai", "anthropic", "azure"

  # ────────────────────────────────────────────────────────────────────────────
  # UI: scope picker (renamed from "Availability")
  # ────────────────────────────────────────────────────────────────────────────

  @visual
  Scenario: Scope picker replaces the old radio group
    When I open the Create Model Provider drawer for "openai"
    Then I see a field labeled "Scope" (not "Availability")
    And the field is a multi-select dropdown (not radio buttons)
    And the dropdown shows three option groups with icons:
      | group        | icon       |
      | Organization | Building2  |
      | Teams        | Users      |
      | Projects     | Folder     |

  @visual
  Scenario: Scope picker supports multiple selections
    Given I open the Create Model Provider drawer for "openai"
    When I select "acme" under Organization
    And I additionally select "platform" under Teams
    Then both selections appear as removable chips in the field
    And each chip renders with the matching icon

  @visual
  Scenario: Scope defaults to the widest tier the user can manage
    Given I open the Create Model Provider drawer for "openai" from project "web-app"
    And I have "organization:manage" on org "acme"
    Then the Scope field is pre-filled with organization "acme"

  @visual
  Scenario: Scope default falls back to team when I cannot manage the org
    Given I open the Create Model Provider drawer for "openai" from project "web-app"
    And I do not have "organization:manage" on "acme"
    And I have "team:manage" on team "platform"
    Then the Scope field is pre-filled with team "platform"

  @visual
  Scenario: Scope default falls back to project when I manage neither org nor team
    Given I open the Create Model Provider drawer for "openai" from project "web-app"
    And I have only "project:manage" on "web-app"
    Then the Scope field is pre-filled with project "web-app"

  @integration @unimplemented
  Scenario: Save a provider with multiple scopes
    Given I open the Create Model Provider drawer for "openai"
    When I set the name to "OpenAI Production"
    And I set the scope to organization "acme" and team "platform"
    And I enter a valid OPENAI_API_KEY
    And I click "Save"
    Then a ModelProvider row is created with name "OpenAI Production"
    And two ModelProviderScope rows exist:
      | scopeType    | scopeId       |
      | ORGANIZATION | acme_org_id   |
      | TEAM         | platform_team |

  @integration @unimplemented
  Scenario: Scope is editable on an existing row
    Given I have a ModelProvider "OpenAI Production" scoped to org "acme"
    When I open its edit drawer
    And I add team "platform" to the Scope field
    And I click "Save"
    Then the row's ModelProviderScope set becomes:
      | scopeType    | scopeId       |
      | ORGANIZATION | acme_org_id   |
      | TEAM         | platform_team |
    # Editing scope of a row with saved credentials does NOT rotate the key;
    # we only add/remove scope rows.

  @integration @unimplemented
  Scenario: Removing the last scope prevents save
    Given I have a ModelProvider "OpenAI Production"
    When I clear every scope entry in the picker
    And I click "Save"
    Then I see a validation error "Provider must have at least one scope"
    And the row is not modified

  @integration @unimplemented
  Scenario: Adding an ORGANIZATION scope requires organization:manage
    Given I am a member of org "acme" without "organization:manage"
    When I open the Create Model Provider drawer
    Then the Organization group in the Scope picker is disabled
    And hovering shows "You need organization:manage permission"

  @integration @unimplemented
  Scenario: Adding a TEAM scope requires team:manage for that team
    Given I have "team:manage" on team "platform" but not on team "marketing"
    When I open the Create Model Provider drawer
    And I expand the Teams group in the Scope picker
    Then team "platform" is selectable
    And team "marketing" is disabled with tooltip "You need team:manage on marketing"

  # ────────────────────────────────────────────────────────────────────────────
  # Multi-instance per provider type
  # ────────────────────────────────────────────────────────────────────────────
  #
  # A credential's display name mirrors the humanized provider label
  # ("OpenAI", "Anthropic", …) — no auto-suffix, no org-scoped uniqueness
  # check. Users disambiguate duplicates through the scope chips on the
  # list page and the scope-grouped header in model selectors.

  @integration @unimplemented
  Scenario: Create a second OpenAI row under a different scope
    Given the org "acme" already has a ModelProvider named "OpenAI" scoped to project "web-app"
    When I open the Create Model Provider drawer and select provider "openai"
    And I keep the default name "OpenAI"
    And I set the scope to organization "acme"
    And I click "Save"
    Then two ModelProviders now exist with name "OpenAI"
    And each one is disambiguated by its distinct scope set

  @integration @unimplemented
  Scenario: Users can edit the name to something custom
    Given I am editing a ModelProvider row
    When I change the Name field to "Production OpenAI"
    And I click "Save"
    Then the row's name is persisted as "Production OpenAI"
    # Editing the name is allowed but never required; default humanized
    # names are enough for the majority of setups.

  @visual
  Scenario: Add Model Provider menu stays open for already-configured providers
    Given I already have one OpenAI row configured
    When I click "Add Model Provider"
    Then the dropdown still includes "OpenAI"
    And selecting it opens the drawer for a brand-new row
    # Previously the menu hid providers that already had a row — we now allow
    # multiple rows per provider type.

  # ────────────────────────────────────────────────────────────────────────────
  # Model Providers page becomes org-level
  # ────────────────────────────────────────────────────────────────────────────

  @visual
  Scenario: Model Providers page does not show a ProjectSelector
    When I navigate to the Model Providers settings page
    Then I do not see a ProjectSelector in the page header

  @integration @unimplemented
  Scenario: Model Providers page lists all accessible rows across scopes
    Given I have access to org "acme" with team "platform" and projects "web-app", "mobile-app"
    And the following ModelProvider rows exist:
      | name                  | provider  | scopes                    |
      | OpenAI Shared         | openai    | ORGANIZATION=acme         |
      | Anthropic Platform    | anthropic | TEAM=platform             |
      | OpenAI Mobile         | openai    | PROJECT=mobile-app        |
      | Azure Web App Only    | azure     | PROJECT=web-app           |
    When I navigate to the Model Providers settings page
    Then I see all four rows listed
    And each row shows the scope chips corresponding to its ModelProviderScope entries

  @integration @unimplemented
  Scenario: Rows outside my permission are hidden
    Given a ModelProvider "OpenAI Other Team" scoped to team "marketing"
    And I have no access to team "marketing"
    When I navigate to the Model Providers settings page
    Then the row "OpenAI Other Team" is not listed

  # ────────────────────────────────────────────────────────────────────────────
  # Model selectors: grouping + wire format
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Model selector groups options by MP name when duplicates exist
    Given I have two openai ModelProviders: "OpenAI Shared" (ORG) and "OpenAI Mobile" (PROJECT=mobile-app)
    When I open the model picker in the Prompt Playground
    Then the options are grouped by header "OpenAI Shared" and "OpenAI Mobile"
    And each group lists the same gpt-5, gpt-5-mini, gpt-4o, ... models
    And choosing a model from "OpenAI Shared" saves the wire value as "{OpenAIShared.id}/gpt-5"
    And choosing a model from "OpenAI Mobile" saves the wire value as "{OpenAIMobile.id}/gpt-5"

  @integration @unimplemented
  Scenario: Model selector hides grouping when a provider has only one row
    Given I have one "OpenAI" ModelProvider and one "Anthropic" ModelProvider
    When I open the model picker
    Then options are grouped per provider ("OpenAI", "Anthropic")
    And the wire value saved for gpt-5 is the canonical "{OpenAI.id}/gpt-5"

  @integration @unimplemented
  Scenario: Legacy "provider/model" wire value resolves when exactly one MP matches
    Given I have exactly one accessible "openai" ModelProvider "OpenAI Shared"
    And a previously-saved Prompt with model "openai/gpt-5"
    When the Prompt is loaded
    Then it resolves against "OpenAI Shared"
    And subsequent save-operations persist the canonical "{OpenAIShared.id}/gpt-5"

  @integration @unimplemented
  Scenario: Legacy wire value errors when multiple MPs match
    Given I have two accessible "openai" ModelProviders "OpenAI Shared" and "OpenAI Mobile"
    And a Prompt previously saved with the legacy value "openai/gpt-5"
    When the Prompt is loaded
    Then the UI shows a banner "Ambiguous provider — re-select your model"
    And the model picker surfaces a clear error state

  @integration @unimplemented
  Scenario: Legacy wire value errors when no MPs match
    Given I have no accessible "cohere" ModelProvider
    And a Prompt was saved long ago with "cohere/command-r"
    When the Prompt is loaded
    Then the UI shows a banner "Provider cohere is not configured for this project"

  # ────────────────────────────────────────────────────────────────────────────
  # Integrations: bind / langwatch_nlp / langevals / workflow
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Gateway provider-binding drawer lists every accessible MP
    Given I have two openai ModelProviders "OpenAI Shared" (ORG) and "OpenAI Mobile" (PROJECT)
    And I am creating a GatewayProviderCredential in project "mobile-app"
    When I open the bind-to-model-provider picker
    Then both rows appear, each showing their name and scope chips
    And choosing one persists GatewayProviderCredential.modelProviderId accordingly

  @integration @unimplemented
  Scenario: langwatch_nlp receives resolved credentials, not MP ids
    Given a Workflow node selects "{OpenAIShared.id}/gpt-5"
    When the workflow executes
    Then langwatch_nlp receives a provider + api_key + base_url payload for that MP row
    And the payload shape is unchanged from the legacy flow (langwatch_nlp has zero changes)

  @integration @unimplemented
  Scenario: Evaluator runs against the MP the user selected
    Given I pick "OpenAI Production / gpt-5" in an evaluator config
    When the evaluator runs
    Then it authenticates with the key stored on "OpenAI Production"
    And tracing records attribute "model_provider.id" = "{OpenAIProduction.id}"

  # ────────────────────────────────────────────────────────────────────────────
  # Permission model — defense in depth (UI + server + DB)
  # ────────────────────────────────────────────────────────────────────────────
  #
  # Principle: a user must not see, read, or assign credentials to scopes they
  # don't belong to. Enforced at three layers:
  #   1. UI — option groups and items disabled / hidden based on hasPermission.
  #   2. Service — ModelProviderService rejects any scope entry whose
  #      (scopeType, scopeId) the caller doesn't hold the matching manage
  #      permission on. Tampered payloads from the client fail closed.
  #   3. Repository — listAccessibleForUser computes the OR of
  #      (scopeType, scopeId) pairs from the user's membership set; rows whose
  #      every scope falls outside that set are never read.

  @integration @security @unimplemented
  Scenario: Service rejects assigning an MP to an org the user is not a member of
    Given I am a member of org "acme" only
    And I tamper with a tRPC payload to set scopes to ORGANIZATION=beta
    When the request hits modelProviderRouter.create
    Then the service throws "Forbidden: organization:manage required on beta"
    And no ModelProvider row is created
    And no ModelProviderScope row is created
    And an audit log entry is written with outcome FAILED_AUTHZ

  @integration @security @unimplemented
  Scenario: Service rejects assigning an MP to a team the user cannot manage
    Given I am a member of team "platform" in org "acme"
    And I have no manage permission on team "marketing" in the same org
    When I submit a create request with scopes = [TEAM=marketing]
    Then the service throws "Forbidden: team:manage required on marketing"
    And the row is not created

  @integration @security @unimplemented
  Scenario: Service rejects updating scopes to add a team the user cannot manage
    Given I own an MP scoped to TEAM=platform
    When I submit an update that replaces scopes with [TEAM=platform, TEAM=marketing]
    And I cannot manage team "marketing"
    Then the update is rejected
    And the existing row's scopes remain [TEAM=platform]
    # Partial-success is explicitly disallowed — either every scope passes authz
    # or the whole write fails.

  @integration @security @unimplemented
  Scenario: listAccessibleForUser never returns rows outside the user's membership
    Given a ModelProvider "X" scoped to team "marketing"
    And I have no access to team "marketing" or any scope that intersects it
    When I call the listAccessible tRPC procedure
    Then the response does not contain row "X"
    And even the row's id is absent from the response
    # This protects enumeration: we don't want clients probing ids.

  @integration @security @unimplemented
  Scenario: getById rejects reading an MP outside the user's scope
    Given a ModelProvider "Y" scoped to team "marketing"
    And I have no access to team "marketing"
    When I call the getById tRPC procedure with the id of "Y"
    Then the call returns NOT_FOUND (not FORBIDDEN)
    # Returning 404 instead of 403 prevents information leakage about whether
    # a given id exists across tenants.

  @integration @security @unimplemented
  Scenario: Deletion requires manage permission on EVERY current scope of the MP
    Given a ModelProvider "Z" scoped to [ORG=acme, TEAM=platform]
    And I have team:manage on platform but not organization:manage on acme
    When I attempt to delete the row
    Then the delete is rejected
    And the row is unmodified
    # A narrower-scope manager cannot silently demolish an org-shared credential.

  @integration @security @unimplemented
  Scenario: UI disables scope options the user cannot manage
    Given I am a member of org "acme" with only project:manage on project "web-app"
    When I open the Create Model Provider drawer from "web-app"
    Then the Organization group in the Scope picker is disabled
    And the Teams group is disabled
    And only project "web-app" is selectable under Projects

  @integration @security @unimplemented
  Scenario: Gateway bind picker only lists MPs the user can read
    Given a ModelProvider "X" scoped to team "marketing" I cannot access
    And a ModelProvider "Y" scoped to org "acme" I can access
    When I open the provider binding picker in a project under org "acme"
    Then "Y" appears in the picker
    And "X" does not appear (even by id)

  # ────────────────────────────────────────────────────────────────────────────
  # Data model (informational — documents the migration)
  # ────────────────────────────────────────────────────────────────────────────

  # ModelProvider (post-migration):
  #   id, projectId (legacy pointer), name, provider, enabled,
  #   customKeys (encrypted), customModels, customEmbeddingsModels,
  #   extraHeaders, deploymentMapping, createdAt, updatedAt
  #
  # ModelProviderScope (new join table):
  #   id, modelProviderId FK, scopeType (ORGANIZATION|TEAM|PROJECT), scopeId
  #   UNIQUE(modelProviderId, scopeType, scopeId)
  #   INDEX(scopeType, scopeId) for access-resolution
  #
  # Backfill: exactly one ModelProviderScope row per existing ModelProvider,
  # taken from its pre-migration (scopeType, scopeId) when available, else
  # defaulting to PROJECT / projectId. Name backfilled verbatim from the
  # humanized provider string ("OpenAI", "Anthropic", …) — no uniqueness
  # enforcement, duplicates are disambiguated by scope chips in the UI.
  #
  # The old (scopeType, scopeId) columns on ModelProvider are dropped in
  # this same migration — no dual-write window, no follow-up cleanup.
