Feature: AI Tools Portal — Admin catalog editor at /settings/governance/tool-catalog
  As an org admin curating which AI tools my team can see on /me
  I want a catalog editor with sections per tile type, drag-to-reorder,
  add/edit drawer, and per-team scoping
  So that I can publish, retire, scope, and order the tile set without
  database access

  Per Phase 7 architecture (rchaves directive 2026-05-03):
    The admin editor is the only authoring surface — no API for tile
    creation outside of /settings/governance/tool-catalog. Reuses Chakra
    Drawer pattern from existing IngestionSource/AnomalyRule editors.
    Reuses iter109 Chakra multi-select scope picker for team-scope binding.

  Background:
    Given organization "acme" exists
    And user "carol@acme.com" is an ADMIN of organization "acme" with `aiTools:manage` permission
    And the `release_ui_ai_governance_enabled` feature flag is on

  Scenario: page is gated by aiTools:manage permission
    Given user "jane@acme.com" is a MEMBER of "acme" without `aiTools:manage` permission
    When user "jane@acme.com" navigates to "/settings/governance/tool-catalog"
    Then the page renders the not-found scene OR the no-permission scene
    And no `api.aiTools.adminList` query is fired

  Scenario: admin sees three sections, even when empty
    Given the org-scoped catalog is empty
    When user "carol@acme.com" loads "/settings/governance/tool-catalog"
    Then the page renders three section headings:
      | Coding assistants (0) |
      | Model providers (0)   |
      | Internal tools (0)    |
    And each section shows an empty-state callout: "No <type> configured. Click Add tile to publish one."
    And each section shows a "+ Add tile" button in its header

  Scenario: admin sees populated catalog with scope badges
    Given the catalog has these admin-visible entries:
      | type             | displayName    | scope        | scopeId          | enabled |
      | coding_assistant | Claude Code    | organization | acme             | true    |
      | coding_assistant | Gemini CLI     | team         | engineering_team | true    |
      | model_provider   | Anthropic      | organization | acme             | false   |
    When user "carol@acme.com" loads "/settings/governance/tool-catalog"
    Then the Claude Code row shows scope badge "Org-wide"
    And the Gemini CLI row shows scope badge "Team: engineering"
    And the Anthropic row renders dimmed (opacity 0.5) because `enabled=false`
    And the Anthropic row's enable/disable button reads "Enable" (not "Disable")

  Scenario: each row has drag handle, scope badge, edit, and disable buttons
    Given the catalog has at least one entry per section
    When user "carol@acme.com" hovers over a row
    Then the row exposes:
      | element           | function                                          |
      | grip-vertical    | drag handle (cursor: grab)                        |
      | display name     | non-interactive label                             |
      | scope badge      | "Org-wide" or "Team: <name>"                      |
      | Edit button      | opens edit drawer pre-populated with entry config |
      | Disable/Enable   | toggles `enabled` field via tRPC mutation         |

  Scenario: + Add tile opens drawer with section's type pre-selected
    Given the editor is loaded
    When user "carol@acme.com" clicks "+ Add tile" in the "Coding assistants" section
    Then a drawer opens
    And the drawer's type radio is pre-selected to "Coding assistant"
    And the drawer's scope picker defaults to "Whole org"

  Scenario: drawer fields differ by tile type
    Given the add-tile drawer is open with type "Coding assistant" selected
    Then the drawer renders fields:
      | Tool          | curated dropdown (Claude Code / Codex / Cursor / Gemini CLI / OpenCode) |
      | Setup command | text input pre-filled per Tool selection                                |
      | Helper text   | optional textarea                                                       |
      | Setup docs URL| optional URL input                                                      |
      | Scope         | Whole-org / Selected teams (multi-select picker)                        |

    Given the type is changed to "Model provider"
    Then the drawer renders fields:
      | Provider               | curated dropdown (Anthropic / OpenAI / Bedrock / Gemini / Vertex / Azure) |
      | Default label          | optional text input                                                       |
      | Suggested routing policy | tRPC-loaded dropdown of org's RoutingPolicy rows                        |
      | Project suggestion text| optional textarea                                                         |
      | Scope                  | Whole-org / Selected teams                                                |

    Given the type is changed to "Internal tool"
    Then the drawer renders fields:
      | Display name           | required text input (free-form)                |
      | Description (markdown) | required textarea with markdown preview        |
      | Link URL               | required URL input                             |
      | CTA label              | optional text input (defaults to "Open <name>")|
      | Logo                   | optional file upload                           |
      | Scope                  | Whole-org / Selected teams                     |

  Scenario: save fires the right tRPC mutation
    Given the add-tile drawer is open
    And user "carol@acme.com" has filled all required fields for an "Internal tool"
    When user "carol@acme.com" clicks "Save tile"
    Then `api.aiTools.create` is called with parameters:
      | type            | "external_tool"            |
      | displayName     | (entered value)            |
      | scope           | (selected scope)           |
      | scopeId         | (selected scope id)        |
      | config          | (markdown + linkUrl + ...) |
    And on success the drawer closes
    And the new tile appears in the catalog list immediately
    And the success toast reads "Tile published"

  Scenario: edit drawer is pre-populated with existing config
    Given the catalog has a Workato entry with stored config
    When user "carol@acme.com" clicks "Edit" on the Workato row
    Then the drawer opens with type "Internal tool" pre-selected (and locked)
    And every field is pre-populated from the stored entry
    And the scope picker reflects the entry's existing scope
    And clicking "Save tile" fires `api.aiTools.update` (not `create`)

  Scenario: drag-to-reorder persists immediately
    Given the Coding assistants section has 3 tiles in order: Claude Code, Codex, Cursor
    When user "carol@acme.com" drags Cursor above Codex
    Then `api.aiTools.reorder` is called with the new ordered ids
    And the row order updates in the UI immediately
    And on page reload the new order persists

  Scenario: disable/enable round-trips
    Given the Anthropic tile is enabled
    When user "carol@acme.com" clicks "Disable" on the Anthropic row
    Then `api.aiTools.setEnabled` is called with `enabled=false`
    And the row dims (opacity 0.5)
    And the button label flips to "Enable"
    And on /me the Anthropic tile is no longer visible to MEMBER users

  Scenario: UI-preview banner renders while backend router is unwired
    Given Sergey's `aiToolsCatalogRouter` is not yet shipped
    When user "carol@acme.com" loads "/settings/governance/tool-catalog"
    Then a yellow/orange banner renders at the top of the page
    And the banner reads "UI preview only" and names the backend dependency
    And mock data renders in the editor
    And no tRPC mutations are fired on Edit/Disable/Add (logged instead)
