Feature: The mail member when no provider is configured

  Mail off is a state, not a boot failure (ARCHITECTURE.md §6). A process
  started with no mail provider boots, and the mail member answers every send
  by skipping it with one log line naming what was not sent. The browser learns
  the same fact from public config's `capabilities.email`.

  @unit
  Scenario: Mail off boots and skips each send with one log line
    Given a process started with MAIL_PROVIDER=off
    When a module reads the mail member and sends a message
    Then the member is built rather than refused
    And the send is skipped with one log line naming the message's subject
