Feature: The growth hooks the transactional messages carry

  Every message LangWatch sends leaves the reader somewhere. A few of them can
  also tell the reader what to do next, and the ones that can are the ones where
  the next thing is genuinely useful: an invitee who cannot tell whether the
  workspace has anything in it, an administrator approving the third colleague
  from one address domain by hand, an organization that has just been told it is
  out of room.

  Three rules run through all of them.

  A message somebody receives while proving who they are is not a place to sell,
  so the password reset, the join-request reminder and the join-request refusal
  carry nothing. One hook per message, because a transactional mail with two
  offers in it stops being transactional. And every hook is optional data with a
  gate: absent data renders nothing, and present data that fails its gate renders
  nothing either.

  A fourth rule governs the ones that name a plan, a price, a seat ceiling or a
  higher tier. Those numbers are only true of an organization buying from the
  public ladder. An organization on legacy enterprise terms, on the newer
  enterprise pricing, or on anything negotiated has limits and a price of its
  own, so it is never quoted a list price; it is pointed at the people who hold
  its contract. A sender that cannot say what comes next for this organization
  says nothing at all.

  @unit
  Scenario: The confirmation mail shows the first-trace step when the quickstart is known
    Given the sign-up verification email carrying first steps
    When it is rendered
    Then the setup lines appear with a link to the quickstart

  @unit
  Scenario: The confirmation mail is only a confirmation without the quickstart
    Given the sign-up verification email carrying no first steps
    When it is rendered
    Then no setup lines appear

  @unit
  Scenario: An invitation names what the team already tracks
    Given the invitation email with a project count above zero
    When it is rendered
    Then the count of projects the team tracks appears

  @unit
  Scenario: An invitation to an empty workspace says nothing about projects
    Given the invitation email with a project count of zero
    When it is rendered
    Then no project count appears

  @unit
  Scenario: An invitation names the person who sent it
    Given the invitation email carrying an inviter name
    When it is rendered
    Then the inviter's name appears in the invitation

  @unit
  Scenario: The re-request mail says a seat is free
    Given the invitation re-request email with a seat still free
    When it is rendered
    Then the seats used and the seats the plan covers appear

  @unit
  Scenario: The re-request mail does not put a wall in front of an administrator
    Given the invitation re-request email with every seat taken
    When it is rendered
    Then no seat count appears

  @unit
  Scenario: A third request from one domain offers automatic joining
    Given the join request arrived email with two approvals from the domain already
    When it is rendered
    Then the offer to let that domain join without asking appears

  @unit
  Scenario: The first request from a domain offers nothing
    Given the join request arrived email with no approvals from the domain yet
    When it is rendered
    Then no offer to let the domain join without asking appears

  @unit
  Scenario: An approved requester is given the checklist beside the door
    Given the join request approved email with an onboarding address
    When it is rendered
    Then the checklist link appears and the organization button is still the action

  @unit
  Scenario: A lapsed request offers a project to work in meanwhile
    Given the join request expired email with a personal project address
    When it is rendered
    Then the personal project link appears as a second line and not as a button

  @unit
  Scenario: An automatic join reports the seats it took
    Given the domain auto-joined email with a seat count
    When it is rendered
    Then the seats used and the seats the plan covers appear after the members settings action

  @unit
  Scenario: A licence from the public ladder links what its plan unlocks
    Given the licence email whose unlocked features were resolved as self-serve
    When it is rendered
    Then the link to what the plan unlocks appears

  @unit
  Scenario: A negotiated licence is pointed at its account team
    Given the licence email whose unlocked features were resolved as account-managed
    When it is rendered
    Then the account team is named and no plan page is linked

  @unit
  Scenario: A licence nothing was resolved for says nothing
    Given the licence email with no unlocked features resolved
    When it is rendered
    Then neither a plan page nor an account team appears

  @unit
  Scenario: A budget request states the spend against the limit
    Given the budget increase request email with a limit above zero
    When it is rendered
    Then the share of the limit already spent appears

  @unit
  Scenario: A budget request with no limit set states no share
    Given the budget increase request email with no limit set
    When it is rendered
    Then no share of the limit appears

  @unit
  Scenario: The usage warning names the plan that removes the limit
    Given the usage limit email with a self-serve next step
    When it is rendered
    Then the plan name and its monthly price appear

  @unit
  Scenario: The usage warning puts the plan under the fix at a full crossing
    Given the usage limit email at a full crossing with a self-serve next step
    When it is rendered
    Then the interruption is stated before the plan is named

  @unit
  Scenario: An organization on negotiated terms is never quoted a price
    Given the usage limit email with an account-managed next step
    When it is rendered
    Then the account team is named and no price and no plan page appear

  @unit
  Scenario: An organization with nothing above it is offered nothing
    Given the usage limit email with no next step
    When it is rendered
    Then neither a price nor an account team appears

  @unit
  Scenario: The usage warning counts in the unit the organization is metered in
    Given the usage limit email metered in events
    When it is rendered
    Then the counts read in events rather than in messages

  @unit
  Scenario: The usage warning names the project carrying most of the month
    Given the usage limit email where one project carries most of the volume
    When it is rendered
    Then that project is named as the place to look first

  @unit
  Scenario: An even spread across projects names none of them
    Given the usage limit email where the volume is spread evenly
    When it is rendered
    Then no project is named as the place to look first

  @unit
  Scenario: A reached ceiling names the tier that allows more
    Given the automation limit email for a reached ceiling with a self-serve next step
    When it is rendered
    Then the tier and the matches a day it allows appear

  @unit
  Scenario: A reached ceiling on negotiated terms names the account team
    Given the automation limit email for a reached ceiling with an account-managed next step
    When it is rendered
    Then the account team is named and no tier ceiling appears

  @unit
  Scenario: A paused automation is never sold more ceiling
    Given the automation limit email for a paused automation with a self-serve next step
    When it is rendered
    Then no tier and no ceiling offer appears

  @unit
  Scenario: The automation notice counts in the unit the organization is metered in
    Given the automation limit email metered in events
    When it is rendered
    Then the notice reads in events rather than in messages

  @unit
  Scenario: A default digest offers the automation's own message
    Given the trigger digest email carrying the automation identifier
    When it is rendered
    Then the link to write the automation's own message appears

  @unit
  Scenario: A digest with no automation identifier offers nothing
    Given the trigger digest email with no automation identifier
    When it is rendered
    Then no link to write the automation's own message appears

  @unit
  Scenario: Every message carries the documentation link once
    Given every registered template rendered from each of its fixtures
    When the rendered message is read
    Then the documentation address appears exactly once

  @unit
  Scenario: The messages a person receives while proving who they are carry no hook
    Given the password reset, the join request reminder and the join request refusal
    When each is rendered from each of its fixtures
    Then none of them names a plan, a price, a seat count or an upgrade

  Rule: Code, data and actions read the same in every message

  A growth line that arrives as a paragraph with a link on the end is not a
  call to action, and a digest of bare identifiers is not a digest. Code is
  coloured, data is a table, and the thing to do is a button. All three are
  written once in the shared shell, because the alternative already happened:
  every message grew its own.

  @unit
  Scenario: Code in a message is coloured without a runtime
    Given a shell line in a message
    When it is coloured
    Then the command is set apart from its arguments

  @unit
  Scenario: A keyword inside a string is not coloured as a keyword
    Given a line with a keyword inside a string
    When it is coloured
    Then the string is coloured whole and no keyword is found inside it

  @unit
  Scenario: A called identifier is coloured as a call
    Given a line calling a function
    When it is coloured
    Then the identifier before the bracket is marked as a call

  @unit
  Scenario: A data table names its columns
    Given a data table with columns and rows
    When it is rendered
    Then each column it draws is named

  @unit
  Scenario: A numeric column is aligned right
    Given a data table with a numeric column
    When it is rendered
    Then that column is aligned right

  @unit
  Scenario: A column no row fills is not drawn
    Given a data table with a column every row leaves empty
    When it is rendered
    Then that column is not drawn

  @unit
  Scenario: A table with nothing in it draws nothing
    Given a data table with no rows
    When it is rendered
    Then nothing is drawn

  @unit
  Scenario: Unknown intent shows the software development kit steps
    Given the first-steps block with no intent
    When it is rendered
    Then the TypeScript lines appear and Python and Go are linked

  @unit
  Scenario: The first-steps block carries the skills command and the agent prompt
    Given the first-steps block
    When it is rendered
    Then the skills command, the agent prompt and the quickstart link all appear

  @unit
  Scenario: An agent-governance organization is shown the command line, not an SDK
    Given a message for an organization that came to watch its agents
    When it is rendered
    Then the command line steps appear and no software development kit lines do

  @unit
  Scenario: An operations organization is shown the software development kit steps
    Given a message for an organization that came to trace an application
    When it is rendered
    Then the software development kit lines appear and no command line install does

  @unit
  Scenario: The agent prompt is pinned to the tracing skill
    Given the tracing skill's own user prompt
    When the agent prompt in the mail is compared against it
    Then the mail asks the agent for what the skill answers

  @unit
  Scenario: A rich digest row shows when, what and the value
    Given a digest row carrying everything the sender had
    When it is rendered
    Then a column is drawn for when it happened, what matched and the value

  @unit
  Scenario: A sparse digest row is as informative as it ever was
    Given a digest row carrying only an identifier
    When it is rendered
    Then the identifier is drawn as a link and no empty column is

  @unit
  Scenario: The digest counts what matched, what is listed and what is not
    Given a digest with more matches than it lists
    When it is rendered
    Then the three counts appear over the table

  @unit
  Scenario: Every message asks for the display face
    Given any rendered message
    When its head is read
    Then the stylesheet serving the display face is linked

  @unit
  Scenario: A client that drops the face keeps the designed fallback
    Given any rendered message
    When its heading style is read
    Then a real serif follows the display face at the same tracking
