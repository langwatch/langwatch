Feature: Custom Model Display Name in Selection UI
  As a user who has given a custom model a friendly Display Name
  I want that name shown wherever the model is listed or selected
  So that I recognise my models by the name I chose instead of a raw provider ID

  # Scope: the READ side of custom models — every surface that renders a model
  # label. The write side (Add Model dialog, the Custom Models table inside the
  # provider drawer) is covered by `custom-models-management.feature` and is not
  # repeated here.
  #
  # Three components independently rebuild a model label from its ID with
  # `split("/").slice(1).join("/")`: `useModelSelectionOptions` (ModelSelector),
  # `ProviderModelSelector`, and `ModelChip`. A custom model's `displayName` is
  # stored and sent to the browser but never read on that path — see #5759.
  #
  # Fixture note: the Display Name is deliberately DISJOINT from the Model ID
  # ("Ada Prod Model" vs "gpt-5.1"). The originally-reported "gpt-5.1-custom" is
  # a superstring of its own ID, so "the raw ID is not shown" is unassertable
  # against it.

  Background:
    Given I am logged in
    And I have access to a project
    And an enabled provider "custom" has a custom chat model
      | Model ID | Display Name   |
      | gpt-5.1  | Ada Prod Model |

  # --- Selection surfaces -------------------------------------------------

  @integration
  Scenario: Dropdown item shows the configured display name
    When I open the Default Models editor and expand the Default role dropdown
    Then the custom model's item reads "Ada Prod Model"
    And that item's label does not contain "gpt-5.1"

  @integration
  Scenario: Collapsed selector shows the configured display name
    Given the custom model is the selected Default role model
    When I view the Default role selector collapsed
    Then it reads "Ada Prod Model"

  @integration
  Scenario: Shared model pickers show the configured display name
    When I open a model picker backed by the shared model-selection options
    Then the custom model is listed as "Ada Prod Model"

  @integration
  Scenario: Default models table chip shows the configured display name
    Given the custom model is saved as the Default role model
    When I view the Default Models table with no editor open
    Then the role's chip reads "Ada Prod Model"

  @integration
  Scenario: Scenario model picker shows the configured display name
    When I open the simulation model picker
    Then the custom model is listed as "Ada Prod Model"

  @integration
  Scenario: Custom embeddings model shows the configured display name
    Given the provider also has a custom embeddings model
      | Model ID     | Display Name   |
      | text-embed-3 | Ada Prod Embed |
    When I expand the Embeddings role dropdown
    Then the embeddings model's item reads "Ada Prod Embed"
    And that item's label does not contain "text-embed-3"

  @integration
  Scenario: Inherit entry shows the display name without replacing its own label
    Given the Default role inherits the custom model from a broader scope
    When I expand a role dropdown that offers an inherit entry
    Then the inherit entry's subtitle reads "Ada Prod Model"
    And the collapsed selector's placeholder reads "Ada Prod Model"
    But the inherit entry's own label still reads the text its caller supplied

  @integration
  Scenario: Model labels outside pickers show the display name
    Given the custom model is referenced by a saved prompt
    When I view a surface that displays the model without offering a choice
    Then it reads "Ada Prod Model"

  # --- Search -------------------------------------------------------------

  @integration
  Scenario: Search by display name finds a renamed model
    When I expand a role dropdown and search for "Ada"
    Then the custom model remains listed

  @integration
  Scenario: Search by model id finds a renamed model
    When I expand a role dropdown and search for "gpt-5.1"
    Then the custom model remains listed

  # --- Regression and failure modes ---------------------------------------

  @integration
  Scenario: Registry model labels are unchanged alongside a custom model
    Given the same provider also offers the registry models "gpt-4o-mini" and "gpt-4o"
    When I expand the Default role dropdown
    Then the registry models still read "gpt-4o-mini" and "gpt-4o"
    And the custom model reads "Ada Prod Model"

  @integration
  Scenario: Selecting a renamed model stores its model id
    When I pick "Ada Prod Model" from the Default role dropdown
    Then the value recorded for that role is the model's full ID, not its display name

  @unit
  Scenario: A blank or incomplete custom entry falls back to the model id
    Given custom entries whose display name is blank, absent, or whose model id is absent
    When display names are resolved for them
    Then entries with a model id resolve to that model id
    And an entry without a model id is skipped
    And no entry resolves to a blank or undefined name

  @unit
  Scenario: A legacy custom model resolves to its model id
    Given a custom entry normalized from the legacy string form, whose display name equals its model id
    When display names are resolved for it
    Then it resolves to its model id

# --- AC Coverage Map ---
# AC1  "Dropdown item shows the Display Name"           → Scenario: Dropdown item shows the configured display name
# AC2  "Closed trigger shows the Display Name"          → Scenario: Collapsed selector shows the configured display name
# AC3  "Shared pickers show the Display Name"           → Scenario: Shared model pickers show the configured display name
# AC4  "Legacy rows render the Model ID"                → Scenario: A legacy custom model resolves to its model id
# AC5  "Registry labels unchanged on a mixed provider"  → Scenario: Registry model labels are unchanged alongside a custom model
# AC6  "Malformed / blank entry falls back"             → Scenario: A blank or incomplete custom entry falls back to the model id
# AC7  "Search still matches the raw Model ID"          → Scenario: Search by model id finds a renamed model
# AC8  "Ripple: selection value unchanged"              → Scenario: Selecting a renamed model stores its model id
# AC9  "Falsifiability at both seams"                   → not a behaviour; it is the falsifiability property OF the
#                                                         scenarios above. Evidenced by the two revert checks recorded
#                                                         on the PR (resolver seam, ProviderModelSelector map-prop seam),
#                                                         each naming the test + assertion that goes red.
# AC10 "Inherit rendering shows the Display Name"       → Scenario: Inherit entry shows the display name without replacing its own label
# AC11 "Default Models table chip"                      → Scenario: Default models table chip shows the configured display name
# AC12 "Search matches the Display Name"                → Scenario: Search by display name finds a renamed model
# AC13 "Scenario model pickers"                         → Scenario: Scenario model picker shows the configured display name
# AC14 "Ripple: non-picker model labels"                → Scenario: Model labels outside pickers show the display name
# AC15 "Custom embeddings models"                       → Scenario: Custom embeddings model shows the configured display name
