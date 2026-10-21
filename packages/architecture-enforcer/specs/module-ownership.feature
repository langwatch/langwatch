Feature: Each table, folder name, error code and peer operation has one owning module
  As a maintainer
  I want reaches into another module's tables, folders named after another module, codes declared twice and services leaning on one peer's Api reported
  So that ownership stays with one module and every new crossing is refused in CI without a human noticing

  See dev/docs/ARCHITECTURE.md §17, rules 13a to 13d (Alex, 2026-10-20). Each is shrink-only: the
  policy reports every finding and tests/baselines/<policy-id>.json holds today's count per key.

  # 13a: prisma-model-ownership

  @unit @architecture
  Scenario: A module reaching a peer's Prisma model is reported
    Given module a's repository claims model Widget and module b calls prisma.widget.findMany
    When the prisma-model-ownership policy reads the modules
    Then it reports b's call, naming Widget and its owner a

  @unit @architecture
  Scenario: Every delegate spelling counts as a reach
    Given module b names the widget delegate through PrismaClient["widget"], Pick<PrismaClient, "widget"> and Delegate<"widget", ...>
    When the prisma-model-ownership policy reads the modules
    Then it reports each spelling as a reach of Widget

  @unit @architecture
  Scenario: The owner reaching its own model is not reported
    Given module a claims model Widget and calls its delegate
    When the prisma-model-ownership policy reads the modules
    Then it reports nothing

  @unit @architecture
  Scenario: A port method named like a delegate call is not a reach
    Given module b calls this.repositories.widget.findMany on a port, not a Prisma client
    When the prisma-model-ownership policy reads the modules
    Then it reports nothing

  @unit @architecture
  Scenario: A model whose owner cannot be derived is listed, not guessed
    Given model Gadget is claimed by no module, its name spells no module, and modules a and b both reach it
    When the owners are derived
    Then Gadget is undetermined with a and b listed, and neither reach is reported

  @unit @architecture
  Scenario: A model's owner is derived from its name when the named module reaches it
    Given model WidgetPart is claimed by no module, its name spells module widget, and widget and b reach it
    When the prisma-model-ownership policy reads the modules
    Then it reports b's reach, naming widget as the owner

  @unit @architecture
  Scenario: A prisma-model-ownership finding says what to do instead
    Given module b reaches module a's model
    When the prisma-model-ownership policy reports it
    Then the finding tells b to ask a through its Api or move the code into a

  @unit @architecture
  Scenario: No new reach of a peer's Prisma model lands
    Given the tree's reaches of a model by a module other than its owner
    When they are counted per file and model
    Then none is above tests/baselines/prisma-model-ownership.json and every listed count is still reached

  # 13b: peer-feature-directory

  @unit @architecture
  Scenario: A feature folder named after another module is reported
    Given module trace has browser/src/features/annotation and annotation is a module
    When the peer-feature-directory policy reads the modules
    Then it reports the folder, naming the annotation module

  @unit @architecture
  Scenario: A plural or hyphenated folder name naming a module is reported
    Given module ops has features/feature-flags and module automation has features/slack-templates
    When the peer-feature-directory policy reads the modules
    Then it reports both, naming feature-flag and slack

  @unit @architecture
  Scenario: A feature folder named for the module's own work is not reported
    Given module trace has features/span-tree and module annotation has features/annotation-queue
    When the peer-feature-directory policy reads the modules
    Then it reports nothing

  @unit @architecture
  Scenario: A peer-feature-directory finding says what to do instead
    Given a module's feature folder named after another module
    When the peer-feature-directory policy reports it
    Then the finding tells it to move the folder into that module or rename it for its own work

  @unit @architecture
  Scenario: No new feature folder named after another module lands
    Given the tree's feature folders named after another module
    When they are listed
    Then none is missing from tests/baselines/peer-feature-directory.json and every listed folder still exists

  # 13c: error-code-single-owner

  @unit @architecture
  Scenario: A code declared by two classes is reported once per class
    Given classes in two modules each declare readonly code "widget_missing" and pass it to super
    When the error-code-single-owner policy reads the tree
    Then it reports widget_missing with both declaring classes

  @unit @architecture
  Scenario: A generic kind of failure is shared on purpose
    Given two classes each declare code "validation_error"
    When the error-code-single-owner policy reads the tree
    Then it reports nothing

  @unit @architecture
  Scenario: A generated Go service code counts as a declaration
    Given codes.generated.ts declares "widget_missing" for a Go service and one class declares it too
    When the error-code-single-owner policy reads the tree
    Then it reports widget_missing with the class and the Go service

  @unit @architecture
  Scenario: A message passed to a built-in Error is not a code
    Given a class extending Error passes "timeout" to super
    When the error-code-single-owner policy reads the tree
    Then it records no declaration

  @unit @architecture
  Scenario: An error-code-single-owner finding says what to do instead
    Given a code two classes declare
    When the error-code-single-owner policy reports it
    Then the finding tells it to keep one owning class or give each failure its own code

  @unit @architecture
  Scenario: No new code gains a second declaring class
    Given the tree's codes declared by more than one class
    When the declaring classes are counted per code
    Then none is above tests/baselines/error-code-single-owner.json and every listed count is still reached

  # 13d: peer-api-fan-in

  @unit @architecture
  Scenario: A service picking four operations of one peer Api is reported
    Given module b's service takes Pick<AApi, "one" | "two" | "three" | "four"> from a's contract
    When the peer-api-fan-in policy reads the services
    Then it reports the service and AApi with four operations

  @unit @architecture
  Scenario: Calls on an injected peer Api field count as operations
    Given module b's service holds a field typed AApi and calls four of its operations
    When the peer-api-fan-in policy reads the services
    Then it reports the four operations

  @unit @architecture
  Scenario: Three operations, or calls that are not the Api's own, are not reported
    Given module b's service picks three operations of AApi and calls map on a local of the field's name
    When the peer-api-fan-in policy reads the services
    Then it reports nothing

  @unit @architecture
  Scenario: A module's own Api is not a peer
    Given module a's service picks four operations of AApi from a's own contract
    When the peer-api-fan-in policy reads the services
    Then it reports nothing

  @unit @architecture
  Scenario: A composition root is not read
    Given module b's app file picks four operations of AApi from a's contract
    When the peer-api-fan-in policy reads the services
    Then it reports nothing

  @unit @architecture
  Scenario: A peer-api-fan-in finding says what to do instead
    Given a service taking four operations of a peer's Api
    When the peer-api-fan-in policy reports it
    Then the finding tells it to ask the peer for one operation or move the service into the peer

  @unit @architecture
  Scenario: No service gains a fourth operation of one peer Api
    Given the tree's services taking four or more operations of one peer Api
    When the operations are counted per file and peer Api
    Then none is above tests/baselines/peer-api-fan-in.json and every listed count is still reached
