Feature: Inspecting a Haven project from the terminal and browser
  Developers can move from a stack to its services, simulators and captured logs
  while output continues to arrive.

  @unit
  Scenario: Clicking a service opens its own deployable view
    When a developer clicks a service in the session list
    Then its own log stream or simulator view opens
    And a quiet backend selects the API logs before its first message

  @unit
  Scenario: The selected service stays visible in a small terminal
    Given more services than fit on the screen
    When the developer selects the final service
    Then that service remains visible within the terminal dimensions

  @unit
  Scenario: Wrapped terminal tabs remain clickable
    Given a terminal too narrow for one row of tabs
    When the developer clicks the identity tab on a later row
    Then the identity simulator view opens

  @unit @regression
  Scenario: Log cursor controls cannot move the viewer's rows
    Given captured output with cursor movement, carriage returns and tabs
    When the viewer draws the output
    Then colours remain and cursor movement cannot change the screen layout
    And clicks outside the log body do not expand a line
    And leaving logs clears the old hit targets

  @unit @regression
  Scenario: Filtered logs scroll and search within the matching lines
    Given interleaved info and error logs
    When the developer filters to errors and scrolls or searches
    Then navigation follows only the matching lines
    And new output preserves a scrolled-back window

  @unit @regression
  Scenario: Unicode searches preserve the original log text
    When the developer searches logs containing Unicode case variants
    Then highlighting leaves the original text intact

  @unit @regression
  Scenario: A partial log write appears once when its line is complete
    Given a service writes one captured line in two parts
    When the viewer polls between those writes
    Then it waits for the complete line
    And shows the full line exactly once

  @unit
  Scenario: Mail and identity tabs keep selection while live data refreshes
    Given a selected message in a simulator tab
    When a newer message arrives
    Then opening the selection still opens the same message
    And filtering selects only matching messages

  @unit
  Scenario: Simulator summaries come from the selected stack's listener
    When Haven reads mail and identity summaries
    Then it uses each simulator's API
    And summaries omit identity credentials

  @unit
  Scenario: A slow simulator cannot block terminal navigation
    Given a simulator is taking time to answer
    When its tab refreshes
    Then the terminal can still switch tabs and accept keys

  @unit
  Scenario: The hub opens a selected stack's project viewer
    When the developer presses Enter or l on a stack in the hub
    Then that stack's viewer opens
    And refreshing the hub preserves the selected stack

  @unit
  Scenario: The web dashboard reads bounded captured logs for a registered stack
    Given a registered stack with several captured service logs
    When the browser requests its logs
    Then it receives recent complete records in time order
    And a service filter returns only that service
    And the response is bounded and cannot be cached

  @unit
  Scenario: Web log requests cannot read outside registered captures
    When a log request names an unknown stack or a path outside its capture directory
    Then no external file contents are returned

  @unit
  Scenario: Mail inbox actions load under the inbox security policy
    When a developer opens the mail inbox
    Then its action script is served from the same origin
    And caught email previews remain sandboxed

  @unit @regression
  Scenario: Expanding the top log record keeps it visible while new output arrives
    Given a full log viewport
    When the developer expands its first visible record
    Then that record stays at the same screen position
    And its details can be scrolled while new output is paused
    And following resumes when the developer presses f

  @unit
  Scenario: Terminal help separates navigation from stack lifecycle actions
    When the developer opens a project viewer in a narrow terminal
    Then detach and stop actions remain visible
    And help can be opened and closed without changing tabs

  @unit
  Scenario: Errors distinguish services and expose the underlying cause
    Given two services report the same wrapper error
    When the developer opens Errors
    Then the services have separate error groups
    And the underlying cause and structured context can be inspected

  @unit @regression
  Scenario: Error selection survives refresh and long details scroll from the top
    Given a selected error with a long stack
    When another error arrives
    Then the selection still opens the chosen error
    And details start at the beginning and can scroll to the end

  @unit
  Scenario: Simulator details open in the terminal before an explicit browser action
    When the developer presses Enter on an identity provider
    Then its users and applications appear in the terminal
    And only pressing o opens the provider in a browser

  @unit
  Scenario: Mail recipients can be inspected and used to filter the terminal inbox
    Given several messages addressed to different recipients
    When the developer selects an address in Mail's recipient view
    Then the inbox shows messages for that address
    And recipient counts count each message once

  @unit
  Scenario: Mail pages identify their stack and retain isolated inboxes
    Given two stack mail listeners accepting the same recipient address
    When a message is sent to one listener
    Then only that stack's inbox contains it
    And its page identifies the stack, SMTP listener and persistence
