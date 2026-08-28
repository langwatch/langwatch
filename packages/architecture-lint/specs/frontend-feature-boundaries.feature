# See ../adrs/004-frontend-feature-boundaries.md

Feature: Frontend feature boundary lint
  As a maintainer
  I want browser composition to have explicit feature and package boundaries
  So that user-facing capabilities can compose narrowly without recreating the monolith

  @unit @architecture
  Scenario: A web package can be governed before its screen migration completes
    Given apps/ui/src/features/catalogue.json opts @langwatch/prompt-web into governance
    And no frontend feature claims its Prompt Studio screen yet
    When architecture lint checks the package exports and dependency closures
    Then broad Prompt web exports fail
    And the export boundary is not reported as a completed Prompt Studio migration

  @unit @architecture
  Scenario: A frontend feature is independent of a backend feature
    Given apps/ui/src/features/catalogue.json declares prompt-studio
    And prompt-studio owns its exact route root and Prompt screen export
    When architecture lint checks the workspace
    Then it does not require prompt-studio to match a packages/features catalogue name
    And it accepts the declared @langwatch/prompt-web/screens/prompt-studio import

  @unit @architecture
  Scenario: A frontend feature imports only its declared contributions
    Given trace-explorer declares a Prompt reference surface in the frontend catalogue
    When it imports @langwatch/prompt-web/surfaces/prompt-reference
    Then architecture lint accepts the import
    And an undeclared feature-web screen or surface import fails with the owning catalogue entry

  @unit @architecture
  Scenario: Owner-only screens cannot be imported by another frontend feature
    Given prompt-studio owns @langwatch/prompt-web/screens/prompt-studio
    When trace-explorer imports that screen
    Then architecture lint reports an owner-screen violation
    And it directs trace-explorer to a declared Prompt surface

  @unit @architecture
  Scenario: A surface cannot pull in its feature's complete implementation
    Given @langwatch/prompt-web/surfaces/prompt-reference imports a Prompt table through a private module
    When architecture lint resolves the surface's production dependency closure
    Then it reports the full import path to the forbidden screen, internal, store, transport, query or route module
    And the surface is not importable until its closure is narrow

  @unit @architecture
  Scenario: An owner-only screen remains browser-safe
    Given @langwatch/prompt-web/screens/prompt-studio reaches private Prompt presentation
    When it directly imports transport, router, session, server, environment or Node.js implementation
    Then architecture lint rejects the screen dependency closure
    And it directs browser data and actions to the owning frontend feature and platform

  @unit @architecture
  Scenario: Exact public UI exports are the only package doors
    Given a governed feature web package exports a screen and a surface
    When another package imports the package root, a wildcard export, or a source path
    Then architecture lint rejects the import
    And it identifies the declared screens/<name> or surfaces/<name> entry point

  @unit @architecture
  Scenario: Governed web packages keep private code in two scoped hierarchies
    Given a governed feature-web package has package-global model, behavior, or UI code
    And it has named private features under features/<feature> with feature.json declarations
    When architecture lint checks production source
    Then flat root files and generic components folders fail
    And model, behavior, elements, blocks, and sections follow their directed responsibilities
    And package-global code does not depend on a private feature

  @unit @architecture
  Scenario: Private web features compose only through declared narrow entries
    Given a private feature section declares another private feature in feature.json
    When it imports that feature's exact index entry
    Then architecture lint accepts the dependency
    And the target entry may curate that target feature's public model, behavior, or UI API
    And a lower layer, deep private import, undeclared dependency, or cycle fails

  @unit @architecture
  Scenario: Public screen and surface boundaries do not leak inward
    Given a governed screen reaches its own private feature sections and surfaces
    When private code imports a screen or surface, a screen imports another screen, or a surface reaches private code
    Then architecture lint rejects the leaking edge
    And browser-safety remains checked through the full recursive closure

  @unit @architecture
  Scenario: Browser dependency edges remain statically visible
    Given apps/ui or a governed screen or surface loads a module through a variable specifier
    When architecture lint checks the dependency closure
    Then it rejects the non-literal dynamic import or require
    And a static string or no-substitution template specifier remains analyzable

  @unit @architecture
  Scenario: Application, platform and frontend feature directions remain distinct
    Given apps/ui production source imports a frontend feature from platform
    Or a frontend feature imports another frontend feature implementation
    Or source is placed outside app, platform, features or testing
    When architecture lint checks the workspace
    Then it reports the prohibited browser-layer dependency or source root
    And app routing and browser capabilities remain in their named owners

  @unit @architecture
  Scenario: Browser source remains independent of backend implementations
    Given a frontend feature, screen or surface uses fetch, transport, router, session, Node.js, a feature server package, generated Prisma, AppRouter, an environment module or a legacy app alias
    When architecture lint checks the source
    Then it rejects the import and identifies the portable contract or platform capability boundary

  @integration @architecture
  Scenario: New browser architecture is strict while legacy application debt shrinks
    Given Prompt is the opted-in frontend pilot
    And a new apps/ui file or Prompt web export violates the frontend policy
    When architecture lint runs
    Then it fails without adding a baseline entry
    And legacy platform/app findings remain only in the deterministic shrinking baseline until deleted
