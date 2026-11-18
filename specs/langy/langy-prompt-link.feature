Feature: A link opens Langy with a question ready to send
  As someone following a link from another tool into LangWatch
  I want Langy to open next to the page with the question already typed
  So that I can read it, edit it and send it myself

  # The link adds `langy=open` and `langyPrompt=<text>` to any project page,
  # for example the Traces page filtered with `#all-traces?q=...`. The
  # parameters are applied once and removed from the address, so a reload
  # does not type the question again. Nothing is sent on the user's behalf.

  Background:
    Given I am signed in with Langy enabled for a project

  @integration
  Scenario: The link opens Langy with the question in the composer
    Given Langy is closed
    When I open "/my-project/traces?langy=open&langyPrompt=Which%20traces%20spent%20the%20most%20tokens%3F"
    Then the Langy panel is open
    And a new conversation is started
    And the composer holds "Which traces spent the most tokens?"
    And no message is sent

  @integration
  Scenario: The parameters are removed after they are applied
    When I open "/my-project/traces?langy=open&langyPrompt=hello#all-traces?q=trace.attribute.laze.agent.id:agent_1"
    Then the address no longer has "langy" or "langyPrompt"
    And the address keeps "#all-traces?q=trace.attribute.laze.agent.id:agent_1"

  @integration
  Scenario: The question waits until the project is known
    Given the project has not loaded yet
    When I open a link with "langyPrompt=hello"
    Then the composer stays empty until the project loads
    And then the composer holds "hello"

  @unit
  Scenario: Opening by link does not change my saved panel preference
    Given I had Langy closed
    When a link opens Langy
    Then the saved preference is still closed
    And after I open or close the panel myself, my choice is saved

  @integration
  Scenario: A link with only the question still opens Langy
    When I open a link with "langyPrompt=hello" and no "langy" parameter
    Then the Langy panel is open
    And the composer holds "hello"

  @unit
  Scenario: A link with an empty question opens Langy without typing anything
    When I open a link with "langy=open&langyPrompt=%20%20"
    Then the Langy panel is open
    And the composer keeps what it had

  @integration
  Scenario: A question link beside a conversation link opens a new conversation
    When I open a link with "langyConversation=<id>&langyPrompt=hello"
    Then the Langy panel is open on a new conversation
    And the composer holds "hello"
    And the address no longer has "langyConversation"

  @integration
  Scenario: A blank question beside a conversation link still opens that conversation
    When I open a link with "langyConversation=<id>&langy=open&langyPrompt="
    Then the Langy panel is open on that conversation
