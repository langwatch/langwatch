Feature: The feature-source-subject lint rule
  A strict feature source file's claimed subject must belong to its own
  feature. A file claiming a subject a different, singular feature already
  owns in the catalogue is reported with the owning feature and a move fix.

  Background:
    Given a workspace whose agent and project features are at strict layout version 0
    And the catalogue lists project as the owner of the project subject

  @unit
  Scenario: A foreign subject claim is reported with its owning feature and a move fix
    Given a service file in the agent feature named project.service.ts
    When the feature-source-subject rule runs over it
    Then it reports foreignSubject naming the subject and its owning feature
    And the message tells the reader to move the file into the owning feature's package

  @unit
  Scenario: A file claiming its own subject is left alone
    Given a service file in the agent feature named agent.service.ts
    When the feature-source-subject rule runs over it
    Then it reports nothing
