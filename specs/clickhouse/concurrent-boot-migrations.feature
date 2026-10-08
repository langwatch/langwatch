Feature: Pods booting together run the ClickHouse migrations one at a time
  The app and the workers both run the ClickHouse migrations at boot, and so
  does every replica of either. goose takes no lock on ClickHouse, so two pods
  starting on an empty database used to apply the same migration at once and
  one of them failed on TABLE_ALREADY_EXISTS and restarted. A fresh Helm
  install showed that as a crashloop on its first boot.

  @integration
  Scenario: Two migration runs started together never overlap
    Given two pods start the ClickHouse migration step at the same moment
    When both reach the migration lock
    Then one runs its migrations while the other waits
    And the second runs only after the first has finished

  @integration
  Scenario: The migration lock is released when the run ends
    Given a pod holds the ClickHouse migration lock
    When its migration run finishes
    Then another connection can take the same lock straight away

  @integration
  Scenario: A failed migration run releases the lock
    Given a pod holds the ClickHouse migration lock
    When its migration run throws
    Then the error reaches the caller
    And another connection can take the same lock straight away
