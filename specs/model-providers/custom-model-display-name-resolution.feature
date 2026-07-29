Feature: Custom Model Display Name resolution is storage- and order-independent
  As a user who configured a custom Display Name on a provider's custom model
  I want that name to resolve in every picker regardless of how my provider rows are stored
  So that the name I chose shows up even with legacy rows, multiple scopes, or canonical model ids

  # Scope: the RESOLUTION of display names (the lookup map + label resolver) —
  # the render surfaces themselves are specified in
  # `custom-model-display-name.feature` (#5759/#5824) and not repeated here.
  # This file covers the three mechanisms #5837's investigation reproduced:
  # legacy-row identity labels, last-row-wins clobbering across multi-scope
  # rows, and canonical `{mpId}/{model}` ids missing the legacy-keyed map.

  Background:
    Given I am logged in
    And I have access to a project
    And an enabled provider "azure" has a custom chat model
      | Model ID | Display Name      |
      | gpt-5.1  | Marketing GPT-5.1 |

  # --- Happy path on the reported surface ----------------------------------

  @integration
  Scenario: The reported production surface shows the configured display name
    When I open the Default Models editor and expand the Default role dropdown
    Then the azure custom model's item reads "Marketing GPT-5.1"
    And the prompt configuration model selector lists it as "Marketing GPT-5.1"

  # --- Order independence across provider rows -----------------------------

  @unit
  Scenario: A legacy row of the same provider does not clobber a configured name
    Given a second "azure" provider row stored in the legacy string form naming the same model id
    When display names are resolved with the legacy row returned last
    And display names are resolved with the legacy row returned first
    Then both resolutions read "Marketing GPT-5.1"

  @unit
  Scenario: Two rows with distinct configured names resolve to one deterministic winner
    Given a second "azure" provider row at a broader scope whose entry for the same model id reads "Company GPT"
    When display names are resolved with the rows in either order
    Then both resolutions read the same single winner
    And the winner is the enabled row, then the narrowest-scoped row,
        then the stored row, then the lowest row id

  # --- Id-form independence -------------------------------------------------

  @unit
  Scenario: A canonical model-provider-id-prefixed id resolves the display name
    Given the model is referenced by its canonical id form, prefixed with the stored provider row's id instead of the provider type
    When its label is resolved
    Then it reads "Marketing GPT-5.1"
    And it does not read the raw model id family

  # --- Failure modes ----------------------------------------------------------

  @unit
  Scenario: A legacy-only provider renders the same label as before display names existed
    Given a provider whose only custom models are stored in the legacy string form
    When display names are resolved for them
    Then each label is non-empty
    And each label equals the model id family that rendered before display names shipped

  @unit
  Scenario: A malformed entry is skipped without breaking valid ones
    Given the custom models list contains one entry missing its model id and one entry whose display name is not a string, alongside the valid entry
    When display names are resolved
    Then resolution does not throw
    And the valid entry still reads "Marketing GPT-5.1"

  @unit
  Scenario: A whitespace-only display name falls back to the model id family
    Given the entry's display name is only whitespace
    When its label is resolved
    Then it reads the model id family and is not blank

  # --- Regression surface -----------------------------------------------------

  @integration
  Scenario: Registry and alias labels are unchanged by the resolution fix
    Given an enabled provider with registry models and a "latest" alias entry
    When I expand the Default role dropdown
    Then the registry model labels read exactly as they did before the change
    And the alias entry still reads its alias label with the resolved model as subtitle

  @integration
  Scenario: Selecting a custom-named model still stores the model id
    When I pick "Marketing GPT-5.1" from the Default role dropdown
    Then the value recorded for that role is the model's full id, not its display name

# --- AC Coverage Map ---
# AC1  "Every picker renders the configured name"            → Scenario: The reported production surface shows the configured display name
#                                                              (remaining pickers: covered by custom-model-display-name.feature's
#                                                              selection-surface scenarios, which must stay green)
# AC2  "Entry + legacy rows: name wins regardless of order"  → Scenario: A legacy row of the same provider does not clobber a configured name
# AC3  "Two entry rows: deterministic documented winner"     → Scenario: Two rows with distinct configured names resolve to one deterministic winner
# AC4  "Canonical {mpId}/{model} id resolves the name"       → Scenario: A canonical model-provider-id-prefixed id resolves the display name
# AC5  "Legacy-only rows: non-empty pre-#5824 label"         → Scenario: A legacy-only provider renders the same label as before display names existed
# AC5b "Malformed entry skipped, no throw"                   → Scenario: A malformed entry is skipped without breaking valid ones
# AC6  "Whitespace displayName falls back, never blank"      → Scenario: A whitespace-only display name falls back to the model id family
# AC7  "Registry + alias labels byte-identical"              → Scenario: Registry and alias labels are unchanged by the resolution fix
# AC8  "Persisted value unchanged (labels only)"             → Scenario: Selecting a custom-named model still stores the model id
# AC9  "Rollback (conditional on backfill strategy)"         → no scenario: the plan chose NO data migration, so the axis is moot;
#                                                              if an implementer later adds a backfill, a rollback scenario MUST be added here.
