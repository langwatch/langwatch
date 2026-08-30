# See dev/docs/adr/123-an-agent-session-is-a-principal.md, and the ADR-092
# entry it implements ("What falls out for free" — Agent principals). The
# ceiling algebra it generalises is ADR-092 section 9, already live for API
# keys; the pair shape is ADR-092 section 4.
#
# WHY THIS SPEC IS IN specs/rbac AND NOT specs/agents OR specs/langy.
# specs/agents/ is about an agent as a stored artefact — creating one, editing
# it, listing it over REST. specs/langy/ owns what a Langy user sees, and
# langy-session-key.feature already specifies today's caller-scoped behaviour
# from the chat's point of view; nothing here restates it. What this file
# specifies is a new PRINCIPAL — engine vocabulary — which is what every other
# file in specs/rbac/ is about, and it sits with the other ADR-092 free-list
# specs that landed alongside it (authz-epoch-cache, expiring-grants,
# denial-explanations).
#
# Vocabulary, used exactly:
#   subject     the person the agent is acting for. Their live grants are one
#               half of the ceiling.
#   actor       which agent is acting. Its role is the other half.
#   agent role  one role, shared by every session of that agent, saying what
#               that agent may ever hold — whoever asks.
#   session     one turn's composed authority. Nothing stores it.
#
# EVERY SCENARIO IS @unimplemented, and for one reason: none of this is built.
# Today a Langy turn runs on a minted, stored API key owned by the requesting
# user (ADR-047), which already gives the intersection but stores it as a
# credential, records no actor, and cannot explain its own denials. The
# scenarios below are the contract for replacing that, not a description of it.
# The one place the two overlap — "the agent cannot exceed the person" — is
# already specified and bound in specs/langy/langy-session-key.feature and is
# restated here only where the new principal changes what the customer sees.
# The tags carry no level (@unit / @integration) on purpose: the seam that
# should bind each of these does not exist yet, and guessing its level now
# would be a decision made in the wrong place. Matches the treatment of the
# unshipped stages in unified-authorization-engine.feature.

@authz @rbac @agents
Feature: Agent principals
  As a member who asks an assistant to do work in LangWatch
  I want the assistant to act with exactly my access and never more, and the
  record to say it was the assistant acting for me
  So that I can hand work to an assistant without handing it authority, and
  anyone reviewing the account can see who really did what

  Background:
    Given an organization "acme" with a project "chatbot"
    And a member "alice" who can create and update prompts in "chatbot"
    And an assistant that members can ask to do work in "chatbot"

  # ═══ Acting for someone ═══════════════════════════════════════════════

  @unimplemented
  Scenario: The assistant does for alice what alice can do
    When alice asks the assistant to update a prompt in "chatbot"
    Then the prompt is updated
    And the assistant holds no role binding of its own that permitted it

  @unimplemented
  Scenario: The assistant's authority is composed for the turn and kept nowhere
    When alice asks the assistant to do anything in "chatbot"
    Then no API key is stored for that turn
    And no role binding is created for that turn
    And no session record outlives the turn
    And nothing is left behind to expire, revoke or clean up when it ends
    And an administrator listing the organization's credentials sees none for
      the assistant

  # ═══ The ceiling, from both sides ═════════════════════════════════════

  @unimplemented
  Scenario: The assistant cannot exceed the person who asked
    Given alice cannot delete datasets in "chatbot"
    When alice asks the assistant to delete a dataset
    Then the assistant is refused
    And the refusal tells alice which of her roles fell short and which would
      grant it

  @unimplemented
  Scenario: The assistant cannot exceed its own role, however much alice can do
    Given alice can publish a public link to a trace
    And the assistant is never allowed to publish public links, whoever asks
    When alice asks the assistant to publish one
    Then the assistant is refused
    And alice reads that this is not something the assistant can be given
    And she is not told to widen anything or to ask an administrator
    And she is pointed at doing it herself in LangWatch

  @unimplemented
  Scenario: When neither the person nor the assistant holds it, the assistant's limit is the answer
    Given alice cannot read her project's stored secrets
    And the assistant is never allowed to read stored secrets, whoever asks
    When alice asks the assistant to read one
    Then she reads that the assistant can never be given it
    And she is not offered a role to ask for, because no role would help

  @unimplemented
  Scenario: Widening what the assistant may hold widens nobody's access
    Given the assistant is allowed to delete datasets
    And alice still cannot delete datasets in "chatbot"
    When alice asks the assistant to delete a dataset
    Then the assistant is refused
    And the refusal is about alice's own access, not the assistant's

  # ═══ The person's access is live, so the assistant's is too ═══════════

  @unimplemented
  Scenario: Demoting alice demotes every assistant session she started
    Given alice has an assistant working in "chatbot"
    When an administrator reduces alice to read-only access on "chatbot"
    Then the assistant's next action for her is refused
    And nothing had to be rotated, revoked or looked up to make that true

  @unimplemented
  Scenario: Offboarding alice leaves no assistant session behind
    Given alice has an assistant working in "chatbot"
    When an administrator offboards alice from "acme"
    Then the assistant can do nothing further for her
    And the offboarding report has no assistant credentials to list

  @unimplemented
  Scenario: Promoting alice mid-conversation raises what the assistant can do for her
    Given alice has an assistant working in "chatbot"
    And alice cannot delete datasets there
    When an administrator grants alice the access to delete datasets
    And alice asks the assistant to delete one
    Then the assistant deletes it
    And alice did not have to start a new conversation for that to take effect

  @unimplemented
  Scenario: Disabling alice's seat stops the assistant with her
    Given alice has an assistant working in "chatbot"
    When an administrator disables alice's membership of "acme"
    Then the assistant's next action for her is refused
    And the refusal says her access was disabled, not that she never had it

  # ═══ The record says who really acted ═════════════════════════════════

  @unimplemented
  Scenario: The record says the assistant acted for alice
    When alice asks the assistant to update a prompt in "chatbot"
    Then the activity record names alice as the person it was done for
    And it names the assistant as what did it
    And a reviewer reading the record can tell it apart from alice doing it
      herself

  @unimplemented
  Scenario: Alice's own work is not attributed to the assistant
    When alice updates a prompt in "chatbot" herself
    Then the activity record names her alone
    And no assistant appears on it

  @unimplemented
  Scenario: An administrator can see everything an assistant did for one person
    Given the assistant has acted for alice several times this week
    When an administrator asks what the assistant did for alice this week
    Then every one of those actions is listed
    And the list does not depend on any credential still existing

  # ═══ When it goes wrong ═══════════════════════════════════════════════

  @unimplemented
  Scenario: Alice signs out while the assistant is still working
    Given alice has an assistant working in "chatbot"
    When alice's session ends
    Then the assistant stops acting for her
    And she is asked to sign in again, once, rather than watching it fail
      repeatedly

  @unimplemented
  Scenario: The assistant has no role to act within
    Given the assistant's own role cannot be resolved
    When alice asks the assistant to do anything in "chatbot"
    Then it is refused, whatever alice holds
    And alice is not told to widen her access or to ask an administrator
    And the failure is recorded as ours, not hers

  @unimplemented
  Scenario: Alice holds nothing the assistant could use
    Given alice holds none of the access the assistant is able to use in
      "chatbot"
    When alice asks the assistant to work there
    Then she is refused before the assistant starts
    And the refusal says what she would need, rather than starting a
      conversation that can do nothing

  # ═══ A session is not a grant ═════════════════════════════════════════

  @unimplemented
  Scenario: An assistant session cannot be granted access of its own
    When an administrator tries to grant access to an assistant session
    Then there is nothing to grant it to
    And access for the assistant is granted by changing its role, which every
      session of that assistant shares

  @unimplemented
  Scenario: A standing review of who can reach a project lists no assistant sessions
    Given several members have assistants working in "chatbot"
    When an administrator reviews who can reach "chatbot"
    Then the members are listed
    And the assistant appears once, as a role, not once per conversation

  # ═══ Deliberately out of scope ════════════════════════════════════════

  # An agent running on a schedule or a trigger has no person to be bounded
  # by, and the ceiling has nothing to intersect. ADR-123 names the candidate
  # answer (a service principal carrying its own explicit bindings) as an open
  # question. Until it is decided, the refusal below is the specified
  # behaviour, so the gap fails loudly instead of defaulting to more access.
  @unimplemented
  Scenario: An assistant asked to act with nobody behind it is refused
    Given a scheduled job tries to run the assistant with no person on whose
      behalf it is acting
    When it asks to do anything in "chatbot"
    Then it is refused
    And the refusal says the assistant acts for a person and none was named
