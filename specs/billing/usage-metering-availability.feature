Feature: Usage decisions when the count cannot be taken

  Monthly usage is counted in ClickHouse and read by four things that each act
  on it differently: limit enforcement, the usage-limit notifier, the threshold
  cron, and the usage page. When the counting store cannot answer, none of them
  may be told a number.

  # The counting services used to return 0 for this and call it fail-open.
  # Letting traffic through during OUR outage is the right call — locking a
  # paying customer out of their own product is the worse of the two errors —
  # but 0 was the wrong way to say it, because a fabricated count cannot be
  # told apart from a real one downstream. So the permissive decision was made
  # implicitly, by a counting service with no business making it, and it was
  # invisible everywhere it took effect: metering switched itself off, the
  # at-limit emails stopped, and the usage page told busy customers they had
  # sent nothing.
  #
  # The count is now reported as unknown, and each consumer decides for itself.
  # Enforcement still allows traffic, but says so out loud and in one place.
  #
  # Two more consumers follow the same rule without a scenario of their own,
  # because neither has a test harness to bind one to yet: the usage-threshold
  # cron skips an organization it cannot count and re-checks on the next tick,
  # and the usage page renders the month's figure as absent rather than zero.

  Background:
    Given an organization on a plan with a monthly message cap

  @unit
  Scenario: Usage limits are not enforced against a count we could not take
    Given the counting store cannot report this month's usage
    When a limit check runs for the organization
    Then traffic is allowed rather than blocked
    And the decision is logged as an unenforced check, not as usage under the cap
    And it is never recorded as zero usage

  @unit
  Scenario: An unknown count is never cached
    Given the counting store cannot report this month's usage
    When a limit check runs and the store recovers before the next one
    Then the next check reads the real count
      # a cached unknown would outlive the outage by the length of the cache TTL,
      # leaving enforcement off for minutes after ClickHouse came back

  @unit
  Scenario: A partial per-project breakdown is reported as unknown, not as zeros
    Given the counting store cannot report usage for one of the projects
    When per-project counts are requested for the organization
    Then the whole set is reported as unknown
      # one unreachable project makes a total or a ranking wrong while still
      # looking like a complete answer

  @unit
  Scenario: The usage-limit email is skipped rather than sent with zeros
    Given an organization has crossed a usage threshold
    And the counting store cannot report the per-project breakdown
    When the usage-limit notifier runs
    Then no email is sent
      # its whole premise is that usage is high; sending it with every project
      # reading 0 tells an admin their usage collapsed
    And the threshold is still crossed on the next run, when the numbers are real
