Feature: Project lists its personal owners and first messages for peers at upgrade
  As project, the module that owns the projects table
  I want my upgrade step to send each personal project's owner and each project that already
  received its first message as my own facts
  So that a peer keeps its own copy from my events, without reading my table

  Live facts cover what happens after the step: organization's personal-workspace facts name a new
  personal project's owner, and trace records a project's first real trace. The step runs once no
  old image serves, so nothing made during the rollout is missed. Archived projects are listed
  alike. A project whose team or organization is gone is skipped and counted. The facts are new
  types, so no existing subscriber (topic clustering, Customer.io delivery) reacts to them.

  @unit @integration
  Scenario: The project history listing sends each personal project's owner
    Given a personal project with an owner, an archived one, one with no owner and a shared project
    When the project:list-personal-owner-and-first-message-facts step runs
    Then one personal owner listed fact is sent for each personal project with an owner, archived included
    And none is sent for the personal project with no owner or the shared project

  @unit @integration
  Scenario: The project history listing sends each project that received its first message
    Given projects that received their first message, one of them archived, and one that did not
    When the step runs
    Then one first message listed fact is sent for each project that received its first message
    And none is sent for the project that did not

  @unit
  Scenario: The project history listing saves its progress after every page
    When the step runs over two pages of projects
    Then each page's facts are sent as one batch per kind
    And the step saves the last project id and the counts after each page

  @unit
  Scenario: A dry run of the project history listing counts what it would send and sends nothing
    When the step runs as a dry run
    Then no fact is sent and no checkpoint is saved
    And the report counts the owner and first message facts a real run sends, by the same rule

  @unit @regression
  Scenario: The project history listing skips a project whose team or organization is gone
    Given a stored project whose team was deleted
    When the step runs
    Then nothing is sent for it
    And the report counts it as a skipped orphan and names its id
    And the saved checkpoint moves past it

  @unit
  Scenario: The project history listing resumes after the last page it saved
    Given the step's checkpoint names a project and its counts
    When the step runs again
    Then only the projects after it are sent
    And the report adds the new counts to the saved ones

  @unit
  Scenario: Re-running the project history listing sends the same facts again
    Given the step already ran
    When it runs again
    Then it sends the same facts for the same projects
    And each fact is keyed by its project, so the rerun appends nothing new

  @unit
  Scenario: The project history listing stops between pages when the worker stops it
    Given a step whose run has been aborted
    When the step runs
    Then nothing is sent and no checkpoint is saved

  @integration
  Scenario: The project history listing is a background step that waits for old writers to go
    When the worker's installed modules list their upgrade steps
    Then project:list-personal-owner-and-first-message-facts is a background data step
    And it runs only once no older image serves
