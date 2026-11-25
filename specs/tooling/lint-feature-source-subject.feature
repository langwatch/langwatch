Feature: The feature-source-subject lint rule
  A strict feature source file's claimed subject must belong to its own
  module. `modules/catalogue.json` maps every subject to one owning module
  and names its root; a file claiming a subject another module owns is
  reported with the owner and a move under the owner's root.

  Background:
    Given a catalogue that gives the project subject to the module rooted at modules/project
    And gives the sso-connection subject to the module rooted at enterprise/modules/sso

  @unit
  Scenario: A foreign subject claim is reported with its owning feature and a move fix
    Given a service file in the agent feature named project.service.ts
    When the feature-source-subject rule runs over it
    Then it reports foreignSubject naming the subject and its owning module
    And the message tells the reader to move the file under the owner's catalogue root

  @unit
  Scenario: A file claiming its own subject is left alone
    Given a service file in the agent feature named agent.service.ts
    When the feature-source-subject rule runs over it
    Then it reports nothing

  @unit
  Scenario: A subject whose owner is not in the tree yet is left alone
    Given a catalogue entry whose root does not exist on disk
    And a service file in the agent feature claiming that entry's subject
    When the feature-source-subject rule runs over it
    Then it reports nothing
