# See dev/docs/adr/124-signed-authorization-passports.md, and the ADR-092
# section it builds out ("Instant checks: the epoch ladder" — the L2 rung).
# Its pair is dev/docs/adr/123-an-agent-session-is-a-principal.md, whose
# scenarios live in specs/rbac/agent-principals.feature: that file specifies
# what an agent session IS, this one specifies what crosses the wire when one
# runs. Where they touch, this file covers only what the passport adds.
#
# WHY THIS SPEC IS IN specs/rbac. A passport is not a credential a customer
# creates, names or manages — there is no screen for it and there never will
# be. It is how the authorization engine answers on a surface that cannot ask
# the database, which is engine vocabulary, so it sits with the other ADR-092
# engine specs (authz-epoch-cache, expiring-grants, denial-explanations,
# agent-principals). The properties it must NOT break are already specified
# and bound in specs/rbac/unified-authorization-engine.feature and
# specs/rbac/authz-epoch-cache.feature — "Revoking a binding takes effect on
# the caller's next request" above all — and are deliberately not restated.
#
# Vocabulary, used exactly:
#   passport        a short-lived signed statement that a request is a named
#                   subject, acted for by a named actor, at a named scope.
#                   Nothing stores one. Nobody sees one.
#   stateless
#   surface         something that answers an access question with no
#                   database and no connection to one: the gateway, the
#                   collector, a shared-link render.
#   change counter  the organization's grant version — bumped by every grant
#                   write, and the thing a passport is stamped against. Named
#                   "epoch" in the engine and in authz-epoch-cache.feature.
#   full check      resolving the answer from the grants themselves, the way
#                   every check works today.
#
# EVERY SCENARIO IS @unimplemented, and for one reason: none of it is built.
# The package README says so in as many words — there is no passport module,
# no service and no export — and the environment variable the design needs is
# reserved and read by nothing. The bitset core and the change counter are
# real and shipped; the thing that would sign anything is not. These scenarios
# are the contract for building it, not a description of it.
# The tags carry no level (@unit / @integration) on purpose: the seam that
# should bind each of these does not exist yet, and guessing its level now
# would be a decision made in the wrong place. Matches the treatment of the
# unshipped stages in unified-authorization-engine.feature and the whole of
# agent-principals.feature.

@authz @rbac @passports
Feature: Authorization passports
  As a LangWatch customer whose access is enforced in more places than one
  I want a part of the platform that cannot reach the database to still know
  exactly who I am and exactly what I may do, and to stop knowing it the
  moment an administrator says otherwise
  So that speed never costs correctness, and taking access away takes it away
  everywhere within a stated, small number of seconds

  Background:
    Given an organization "acme" with a project "chatbot"
    And a member "alice" who can view and update prompts in "chatbot"
    And a part of the platform that serves "chatbot" without any database

  # ═══ Answering without a database ═════════════════════════════════════

  @unimplemented
  Scenario: A surface with no database still answers alice's request
    When alice makes a request that surface must authorize
    Then the request is allowed
    And nothing was read from any database to allow it
    And nothing about alice was looked up anywhere

  @unimplemented
  Scenario: The answer is exactly the answer the engine would have given
    Given alice can update prompts in "chatbot" and cannot delete them
    When the surface with no database is asked both questions for her
    Then it allows the update and refuses the delete
    And a full check made at the same moment agrees with it on both

  @unimplemented
  Scenario: A passport is good only for the scope it names
    Given alice can update prompts in "chatbot"
    And there is a second project "billing" where she can do nothing
    When a passport issued for her work in "chatbot" is presented for "billing"
    Then the request is refused
    And the refusal does not depend on anyone looking up what she holds in
      "billing"

  # ═══ Taking access away ═══════════════════════════════════════════════

  @unimplemented
  Scenario: A revoked grant stops a passport that was still within its lifetime
    Given alice is working through the surface with no database
    And her passport has time left on it
    When an administrator revokes her access to "chatbot"
    Then her next request through that surface is refused
    And it is refused because her access changed, not because time ran out

  @unimplemented
  Scenario: A passport never outlives a demotion by more than a minute
    Given alice is working through the surface with no database
    When an administrator reduces what she may do in "chatbot"
    Then no request of hers is allowed on the old access more than a minute
      after the change
    And that bound holds even if the surface never hears about the change at
      all

  @unimplemented
  Scenario: Revoking alice stops her everywhere at once
    Given alice is working through two different surfaces at the same time
    When an administrator revokes her access to "chatbot"
    Then both surfaces refuse her next request
    And nobody had to find, list or name anything she was holding

  @unimplemented
  Scenario: One passport cannot be stopped on its own
    Given alice is working through the surface with no database
    When an administrator tries to stop that one request-in-flight without
      changing anybody's access
    Then there is nothing to stop
    And the documented way to stop it is to change what she may do, which
      stops all of her work at once

  @unimplemented
  Scenario: An expired passport is refused even where nothing has changed
    Given nobody's access in "acme" has changed for a week
    When a passport older than its stated lifetime is presented
    Then the request is refused
    And the refusal says it expired, not that she lacks the access

  # ═══ When the surface cannot see the change counter ═══════════════════

  @unimplemented
  Scenario: A surface that cannot see the change counter falls back to a full check
    Given the surface can read the organization's change counter
    And alice can update prompts in "chatbot"
    When the change counter becomes unreadable
    And alice makes a request that surface must authorize
    Then the answer is resolved by a full check instead
    And she gets the same answer she would have got otherwise
    And the passport is not trusted to answer on its own

  @unimplemented
  Scenario: A surface that can neither see the counter nor make a full check refuses
    Given the surface has no way to make a full check
    When it can no longer see the organization's change counter
    And alice makes a request
    Then the request is refused
    And the failure is recorded as ours, not hers
    And it is refused rather than answered from what the passport claims

  @unimplemented
  Scenario: A stale reading of the change counter is treated as no reading at all
    Given the surface last read the change counter longer ago than it is
      allowed to rely on
    When alice makes a request
    Then the passport is not trusted to answer on its own
    And the surface behaves exactly as it does when it has never read the
      counter

  @unimplemented
  Scenario: A passport stamped against a different counter is refused
    Given the platform is midway through changing which counter it stamps
      passports against
    When a passport stamped against the old counter reaches a surface reading
      the new one
    Then the request is refused
    And the two numbers are never compared against each other

  # ═══ Acting for someone ═══════════════════════════════════════════════

  @unimplemented
  Scenario: A passport for an assistant names both who acted and who it acted for
    Given alice has asked an assistant to do work in "chatbot"
    When the assistant makes a request on her behalf
    Then the request carries alice as the person it is for
    And it carries the assistant as the thing doing it
    And neither of those was asserted alongside the request by anything that
      could have made it up

  @unimplemented
  Scenario: The assistant's answer is resolved live, not carried
    Given alice has asked an assistant to do work in "chatbot"
    When an administrator changes what alice may do while the work is running
    Then the assistant's next action reflects her new access
    And the change takes effect whether it widened or narrowed what she holds

  @unimplemented
  Scenario: A passport says whether the actor limits the subject or only records them
    Given a request is made for alice by something that is not alice
    Then the request states whether that thing caps what alice may do or only
      records that it acted
    And that statement is part of what is signed, not worked out afterwards

  @unimplemented
  Scenario: Work that runs longer than a passport lives keeps running
    Given alice has asked an assistant to do work that takes several minutes
    When the work runs past the lifetime of the passport it started with
    Then the work continues
    And every action it takes reflects alice's access at the moment it takes it

  @unimplemented
  Scenario: Work stops when its authority can no longer be renewed
    Given alice has asked an assistant to do work that takes several minutes
    When the assistant can no longer be given fresh authority
    Then the work stops
    And alice is told once, rather than watching it fail repeatedly

  # ═══ Refusing what should be refused ══════════════════════════════════

  @unimplemented
  Scenario: An altered passport is refused
    When any part of a passport is changed after it was issued
    Then the request is refused
    And no claim it carries is acted on

  @unimplemented
  Scenario: A passport signed by something that is not us is refused
    When a passport arrives signed by a key we did not issue
    Then the request is refused
    And it is refused before anything in it is read as a fact

  @unimplemented
  Scenario: A passport that names a weaker way of signing is refused
    When a passport arrives claiming it was signed some other way, or not
      signed at all
    Then the request is refused
    And what it claims about how it was signed does not change how it is
      checked

  @unimplemented
  Scenario: A token meant for something else is refused
    When a token issued for another part of the platform is presented as a
      passport
    Then the request is refused
    And presenting it does not authorize anything

  @unimplemented
  Scenario: A passport in a format we do not understand is refused
    Given a passport is issued in a newer format than a surface understands
    When it is presented to that surface
    Then the request is refused
    And the surface does not read the parts it recognizes and guess the rest

  @unimplemented
  Scenario: A carried answer is refused where a live answer is available
    Given a surface that can resolve the answer itself
    When a passport arrives carrying an answer already worked out
    Then the surface refuses the carried answer
    And it resolves the question itself

  # ═══ Rotating the key ═════════════════════════════════════════════════

  @unimplemented
  Scenario: Passports issued before a key change keep working until they expire
    Given the key used to sign passports is replaced
    When a passport signed with the previous key is presented within its
      lifetime
    Then the request is allowed
    And no customer request fails because of the change

  @unimplemented
  Scenario: A passport signed with a retired key stops working
    Given the key used to sign passports was replaced twice
    When a passport signed with the oldest key is presented
    Then the request is refused

  # ═══ Nothing is stored ════════════════════════════════════════════════

  @unimplemented
  Scenario: A passport leaves nothing behind
    When alice works through the surface with no database all day
    Then nothing was created that has to expire, be revoked or be cleaned up
    And an administrator listing the organization's credentials sees none of
      it

  @unimplemented
  Scenario: A customer is never asked to know about passports
    When alice is refused something through a surface with no database
    Then she reads why she was refused in terms of her own access
    And nothing she reads mentions a passport, a counter or a signature

  # ═══ Deliberately out of scope ════════════════════════════════════════

  # A shared link is used by someone with no account at all, so there is no
  # subject whose access could be resolved and no session to bound the
  # lifetime by. ADR-124 names this as undecided rather than deferring it
  # quietly, and ADR-092's rule that a shared link is answered by possession
  # of the link and not by the existence of a row still governs. Until it is
  # decided, a passport is not issued for one — so the gap fails loudly
  # instead of defaulting to more access.
  @unimplemented
  Scenario: A visitor with only a shared link gets no passport
    Given a visitor holds a link to a shared trace and has no account
    When they open the link
    Then they see the trace, by the rules that already govern shared links
    And no passport was issued for them
