Feature: Project becomes integrated after first trace ingestion
  Projects using event-sourcing ingestion mark themselves as integrated
  when the first trace arrives, enabling the messages page to render
  the trace list instead of the welcome screen.

  @integration
  Scenario: Project marks as integrated after first trace ingestion
    Given a project with firstMessage set to false
    And the project uses event-sourcing ingestion
    When a trace is processed through the trace-processing pipeline
    Then project.firstMessage is set to true
    And project.integrated is set to true
    And project.language is detected from SDK attributes

  @integration
  Scenario: Messages page renders trace list for integrated projects
    Given a project with featureEventSourcingTraceIngestion enabled
    And disableElasticSearchTraceWriting enabled
    When traces are ingested via the OTel endpoint
    Then firstMessage is set to true
    And the messages page renders the trace list instead of the welcome screen
