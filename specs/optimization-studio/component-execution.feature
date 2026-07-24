Feature: Optimization Studio component and workflow execution
  As a user building a workflow in the Optimization Studio
  I want to run a single component or the workflow up to a node
  So that I can test my pipeline with manual inputs

  # ---------------------------------------------------------------------------
  # Trace id generation underpins every execution: each run mints a fresh OTel
  # trace id before posting the execute event. It must work in the bundled
  # client, not only in dev, so the "Run with manual inputs" and "Run workflow
  # until here" actions never throw at click time.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Generated trace id has the OpenTelemetry format
    When a workflow trace id is generated
    Then it is 32 lowercase hexadecimal characters
    And it is not the all-zero invalid id

  @unit
  Scenario: Generated span id has the OpenTelemetry format
    When a workflow span id is generated
    Then it is 16 lowercase hexadecimal characters
    And it is not the all-zero invalid id

  @unit
  Scenario: Repeated generation yields unique trace ids
    When many trace ids are generated in a row
    Then each generated id is unique

  Scenario: Running a component with manual inputs starts execution
    Given a connected studio with a component that has its required inputs filled
    When the user clicks "Run with manual inputs"
    Then a fresh trace id is minted without error
    And an execute_component event is posted for that node
