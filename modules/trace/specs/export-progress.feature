@trace @export
Feature: Export progress
  As someone downloading a trace export or a scenario run export
  I want to watch that export's progress until it finishes
  So that a long download shows how far it has got

  @unit
  Scenario: A viewer sees only the progress of the export they started
    Given two exports running in the same project
    When the viewer watches one of them
    Then only that export's progress frames reach the viewer

  @unit
  Scenario: The progress stream ends when the export finishes or fails
    Given a viewer watching an export
    When a done or an error frame for that export arrives
    Then that frame is delivered and the stream ends

  @unit
  Scenario: An unreadable progress frame is skipped
    Given a viewer watching an export
    When a frame that is not a progress event arrives
    Then it is skipped and the next frame still reaches the viewer

  @unit
  Scenario: Watching an export releases the project's broadcast when it ends
    Given a viewer watching an export
    When the stream ends
    Then the project's broadcast emitter is released

  @unit
  Scenario: Trace and scenario run exports are watched under their own permissions
    When the export namespace is declared
    Then onExportProgress asks for traces:view
    And onScenarioRunExportProgress asks for scenarios:view

  @unit
  Scenario: Both export doors relay the watched export's frames
    Given a viewer watching an export
    When they subscribe through onExportProgress or onScenarioRunExportProgress
    Then each door relays the frames the export progress stream yields for that project and export
