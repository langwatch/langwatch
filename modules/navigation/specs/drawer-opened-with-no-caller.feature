Feature: A drawer opened from a link, with nothing behind it
  As someone who followed a link into a drawer
  I want the drawer to finish the job and get out of the way
  So that a pasted address is a way in and not a dead end

  Every drawer in the product is URL-routed: `?drawer.open=<name>` plus one
  `drawer.<key>` per parameter, resolved through the application's registry
  (dev/docs/best_practices/drawers.md). That makes two kinds of open, and only
  one of them has been thought about. A drawer opened BY ANOTHER SURFACE gets
  props that surface passed — including callbacks, which travel in memory
  beside the address. A drawer opened BY AN ADDRESS ALONE gets exactly what the
  URL carried, and a URL carries no functions.

  So a drawer that requires a callback works everywhere it is mounted and
  crashes where it is addressed, at whatever moment it first calls the thing
  that is not there. That is usually the moment the work has just been done and
  the crash is at its most expensive.

  Rule: A drawer reached from an address alone still finishes its work

    The ending for such an open is closing: the drawers doc says a sub-flow
    navigates to a drawer and returns through `onClose`, and an open with no
    caller has only the return leg. Nothing about the work itself changes.

    @integration
    Scenario: A bare-URL open of the dataset editor creates the dataset and closes
      Given a link that opens the dataset editor and names no caller
      When the reader names a dataset and creates it
      Then the dataset is written
      And the editor closes

  Rule: A drawer a surface opens by name is one a module declares

    @integration
    Scenario: The dataset editor opens by its drawer name
      Given dataset is installed
      When a surface opens the "addOrEditDataset" drawer
      Then dataset's create-or-edit editor mounts

    @unit
    Scenario: The run plan editor opens by its drawer name
      Given scenario is installed
      When a surface opens the "suiteEditor" drawer
      Then scenario's run plan editor loads

    @unit
    Scenario: The model provider editor opens by its drawer name
      Given model-provider is installed
      When a surface opens the "editModelProvider" drawer
      Then model-provider's provider editor loads

    @unit
    Scenario: The default model override editor opens by its drawer name
      Given model-provider is installed
      When a surface opens the "defaultModelOverride" drawer
      Then model-provider's default model override editor loads

    @unit
    Scenario: The model cost editor opens by its drawer name
      Given model-provider is installed
      When a surface opens the "llmModelCost" drawer
      Then model-provider's model cost editor loads

  Rule: A drawer the host mounts is open

    The host mounts only the drawer the address names, so the drawer's `open`
    prop is `true` there. It is never the drawer's name string: a drawer that
    checked `open === true` against the name read itself as closed and never
    rendered, which left the prompt editor and the agent editors dead.

    @integration
    Scenario: A drawer the host mounts from an address reads itself as open
      Given an address that names a drawer
      And the drawer renders only when its open prop is true
      When the page renders
      Then the drawer is on screen
