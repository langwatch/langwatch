Feature: Notification service
  Durable notification records are owned by one feature service.

  Scenario: Create a notification record
    Given a valid organization notification command
    When the Notification service creates the record
    Then it returns the persisted notification with its timestamps

  Scenario: Find recent organization notifications
    Given notification records for an organization
    When the service queries records since a timestamp
    Then it returns matching records newest first
