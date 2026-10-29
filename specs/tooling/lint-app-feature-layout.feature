Feature: The app-feature-layout lint rule
  An application that is not a module host (the public docs site) opts into the
  app-features layout with `"langwatch": { "layout": "app-features" }` in its
  package.json, and declares its features and the features each one imports.
  Its `src/` then holds features of four layers (model, compile, ui, browser),
  shared leaves (`lib/` and the top-level files) and the composition (app/,
  site/, browser/, testing/). The tables live in
  packages/oxlint-rules/grammar/app-feature-layout.mjs; ADR-137 holds the decision.

  Background:
    Given a workspace whose site application declares code, navigation and shell features

  @unit
  Scenario: Only an application that opts in is governed
    Given an application without the layout opt-in, and a test file of one with it
    When the app-feature-layout rule runs over them
    Then it reports nothing

  @unit
  Scenario: Each layer takes only what its row allows
    Given a model importing a component and build-time code, build-time code and an island importing a component
    When the app-feature-layout rule runs over them
    Then it reports layerCrossing on each of those imports
    And an import of the model, a sibling, `lib/` or a stylesheet passes

  @unit
  Scenario: Another feature is reached only through its layer entry
    Given a component importing a file inside another feature, and one importing that feature's entries
    When the app-feature-layout rule runs over them
    Then it reports internalReach for the file and nothing for the entries

  @unit
  Scenario: A feature imports only the features it declares
    Given a navigation component importing the shell entry, which navigation does not declare
    When the app-feature-layout rule runs over it
    Then it reports undeclaredDependency

  @unit
  Scenario: A feature imports its own files directly
    Given a navigation component importing the navigation ui entry
    When the app-feature-layout rule runs over it
    Then it reports ownEntry

  @unit
  Scenario: The composition reaches features through their entries
    Given the composition importing a feature file, entries of two layers and a stylesheet, and a feature importing the composition
    When the app-feature-layout rule runs over them
    Then it reports internalReach for the file and reachesComposition for the feature

  @unit
  Scenario: Shared leaves import only each other
    Given a `lib/` file importing a feature entry, the composition, a top-level file and a sibling
    When the app-feature-layout rule runs over it
    Then it reports leafReachesUp for the feature and the composition only

  @unit
  Scenario: A feature entry only re-exports its own layer
    Given a ui entry holding named re-exports of its own layer, and one holding an import, another layer, a star export and code
    When the app-feature-layout rule runs over them
    Then the first passes and the second reports entryShape on each statement

  @unit
  Scenario: Every file sits in a known place
    Given a file in an unknown top-level folder and a file beside a feature's layers
    When the app-feature-layout rule runs over them
    Then it reports unknownPlace for both

  @unit
  Scenario: Every feature is declared and the graph is acyclic
    Given a feature folder the package.json does not declare, and two features that declare each other
    When the app-feature-layout rule runs over them
    Then it reports undeclaredFeature for the first and dependencyCycle, naming the cycle, in both of the others
