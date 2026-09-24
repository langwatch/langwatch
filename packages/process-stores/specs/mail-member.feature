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

  @unit
  Scenario: Mail off still names the sender main answered
    Given a process started with MAIL_PROVIDER=off
    When a module asks the mail member for its default sender
    Then it answers LangWatch <contact@langwatch.ai>, as main did with no address configured

  @unit
  Scenario: A configured gateway answers its sending address as the default from
    Given a mail gateway configured with a sending address
    When a module asks the mail member for its default sender
    Then it answers that configured address

  @unit
  Scenario: A send carries its BCC recipients and headers to the gateway
    Given the mail member over a configured gateway
    When a module sends to a no-reply address with BCC recipients and a List-Unsubscribe header
    Then the gateway is handed the BCC recipients and the header unchanged
