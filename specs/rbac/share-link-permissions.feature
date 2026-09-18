# See dev/docs/adr/092-unified-authorization-engine.md (§8, the resource tier)
# and dev/docs/adr/057-token-gated-trace-sharing.md.
#
# Scope note, because three specs touch share links and each owns one part:
#   specs/traces-v2/sharing.feature          what a sharer and a viewer DO
#                                            (mint, visibility, expiry, views)
#   specs/rbac/unified-authorization-engine  what the ENGINE decides about a
#                                            resource grant (audience, links,
#                                            possession)
#   this file                                what one link may SAY, and that
#                                            the thing it says is what gets
#                                            enforced end to end
#
# Vocabulary, used exactly:
#   link          one share link: one secret token, one row, one permission
#   confers       what a holder of the token may do, and nothing more
#   allowlist     the closed set of values a link may be minted with

@authz @grants @rbac @sharing
Feature: A share link states what it confers
  As an operator sharing a trace with someone outside the project
  I want to choose whether they may only read it or may also comment on it
  So that a reviewer can leave feedback without being given an account, and a
  read-only link stays read-only

  # One link carries ONE permission. "Annotate" therefore names a value that
  # confers BOTH reading and commenting, because a link that let someone
  # comment on a trace they cannot see would grant nothing usable. The set is
  # closed on purpose: a link is a bearer capability handed to whoever
  # receives the URL, so what it can ever say has to be readable in one
  # sitting.

  Background:
    Given a project with trace sharing enabled
    And a trace in that project

  Rule: A link says "view only" unless its minter says otherwise

    @unit
    Scenario: A link minted without a permission stays read-only
      When I create a share link without saying what it may do
      Then the link confers reading the trace and nothing else
      And the link is stored exactly as links were before permissions existed

    @unit
    Scenario: Links created before permissions existed are unchanged
      Given a share link created before links could state a permission
      When someone opens it
      Then they can read the trace
      And they cannot annotate it

  Rule: An annotate link confers reading as well as commenting

    @unit
    Scenario: An annotate link lets its holder annotate the shared trace
      When I create a share link that allows annotating
      And someone presenting that link asks to annotate the trace
      Then they are allowed

    @unit
    Scenario: An annotate link also lets its holder read the trace
      Given a share link that allows annotating
      When someone presenting it asks to read the trace
      Then they are allowed
      And no second link was created to say so

  Rule: A link never confers more than it states

    @unit
    Scenario: A view-only link cannot annotate the trace it shows
      Given a read-only share link
      When someone presenting it asks to annotate the trace
      Then they are refused

    @unit
    Scenario: An annotate link confers nothing beyond reading and commenting
      Given a share link that allows annotating
      Then the only things its holder may do are read the trace and comment on it

    # The allowlist means the same thing at both ends. Minting refuses a
    # permission we do not offer, so a row carrying one — left by an older
    # writer, a hand-run statement or a corrupted write — confers nothing
    # rather than the thing the mint would have refused.
    @unit
    Scenario: A stored permission outside the allowlist confers nothing
      Given a share link whose stored permission is not one we offer
      When someone presents it
      Then it confers nothing at all
      And the holder is refused what the row named

  Rule: A link cannot be minted for something sharing does not confer

    @unit
    Scenario: A share link cannot be minted for something it may not grant
      When I try to create a share link that allows managing datasets
      Then the link is not created
      And I am told a share link cannot grant that
      And I am given the values I could have asked for instead

  Rule: The permission travels with the link wherever it is stored

    @unit
    Scenario: A minted link records what it confers on the grants ledger
      When I create a share link that allows annotating
      Then the fact recorded for it names that permission

    # The whole point of the column: a link that says something other than
    # "view" has to keep saying it if the organization is rolled back onto
    # the legacy tables.
    @unit @integration
    Scenario: A non-default permission survives on both stores
      Given a share link that allows annotating
      Then both the grants ledger and the compatibility row carry that permission

  Rule: What the customer can reach today

    # The permission is enforced wherever a caller asks the authorization
    # engine, which is where any annotate consumer will ask. What does NOT
    # exist yet is the consumer: the shared trace page is read-only, and
    # every annotation write is behind a signed-in session. Minting an
    # annotate link is therefore possible through the API and confers exactly
    # what it says, but nobody can spend it from the share page. These
    # scenarios pin the product surface that is still missing, and they stay
    # @unimplemented until it is built - not bound to a passing test that
    # would report it as done.
    @e2e @unimplemented
    Scenario: The share dialog offers what the link may allow
      Given I am creating a share link from the trace view
      When I choose to let the recipient comment
      Then the link I copy allows commenting

    @e2e @unimplemented
    Scenario: A recipient of an annotate link comments without signing in
      Given an annotate share link for a trace
      When the recipient opens it and leaves a comment
      Then the comment appears on the trace
      And it is attributed to the link rather than to a member

    @e2e @unimplemented
    Scenario: A recipient of a read-only link is offered no way to comment
      Given a read-only share link for a trace
      When the recipient opens it
      Then the page offers no way to leave a comment
