Feature: Reading the directory back - a page of people that means what it says
  As an identity provider reconciling thousands of people against LangWatch
  I need a listing whose pages tile the directory exactly once, whose counts
  describe the page I was actually given, and whose filters either answer the
  question I asked or refuse it
  So that a sync over a large organization provisions each person once instead
  of provisioning some twice and never seeing the rest

  # D08's companion. The push side keeps its own file
  # (specs/identity/scim-connection-sync.feature); this one is the READ side -
  # what a provider sees when it asks who we think is here. That is the half a
  # sync starts with, and every mistake in it is silent: a provider believes
  # what the listing says.
  #
  # Nothing here is hypothetical. Each rule below is written against a defect
  # the local identity-provider simulator found the first time it was pointed
  # at a directory of five thousand people rather than a handful
  # (specs/setup/idp-simulator.feature).
  #
  # Three things a listing has to get right, and all three are about SCALE -
  # a directory small enough to fit in one page hides every one of them:
  #
  #   THE ORDER      A page is a window, and a window onto an unordered
  #                  result is a different set of people each time it opens.
  #                  Fifty pages over five thousand people is fifty separate
  #                  questions, and unless every one of them is cut from the
  #                  same order, the answers overlap and leave gaps.
  #
  #   THE COUNTS     `itemsPerPage` is how many people this page holds, not
  #                  how many were asked for. A provider that advances by
  #                  what we reported rather than by what it received walks
  #                  off the end of the directory early.
  #
  #   THE FILTER     A question we cannot answer gets refused. Answering it
  #                  with the whole organization is worse than refusing,
  #                  because a provider reads the first row back as the
  #                  person it asked about - and then writes to them.
  #
  # The page ceiling itself (a hundred, however many are asked for) keeps its
  # own file: specs/identity/scim-connection-sync.feature covers what a token
  # may reach, and the cap is pinned by the route's own suite.

  Background:
    Given an organization "acme" on the Enterprise plan, administered by "ana"
    And "acme" has an ACTIVE SSO connection "okta-primary" with directory sync enabled
    And the directory holds five thousand people

  # ── A page is a window onto one fixed order ────────────────────────────

  Rule: Every page is cut from the same order, so the pages tile the directory

    @unit
    Scenario: Paging through a large directory lists everybody exactly once
      Given a provider reads the directory a hundred people at a time
      When it walks from the first page to the last
      Then it has seen every person in "acme" exactly once
      And no page repeated somebody an earlier page already carried

    @unit
    Scenario: The order a page is cut from is fixed rather than whatever the store offers
      When a provider asks for any page of people
      Then the people are taken in a settled order that is the same on every request
      And two identical requests a minute apart answer with the same page

    @unit
    Scenario: Groups are paged from a settled order too
      Given "acme" has more directory groups than fit on one page
      When a provider walks every page of groups
      Then it has seen every group exactly once
      And groups created in the same instant still have an order between them

    # The honest limit of counted paging, stated rather than discovered. A
    # walk is a sequence of separate questions, so a directory that changes
    # underneath one can hand the same person to two pages. That is a repeat,
    # which a provider absorbs — it re-asserts somebody it already has. What
    # a fixed order buys is that this is the WORST it degrades to, instead of
    # the arbitrary overlap-and-gap an unordered scan gives.
    @unit
    Scenario: A directory that grows mid-walk repeats somebody rather than losing them
      Given a provider has read the first page of people
      When somebody joins "acme" before it asks for the second page
      Then every person who was present when the walk started is still seen before it ends
      And the most a provider suffers is being handed somebody twice

  # ── The counts describe the page, not the request ──────────────────────

  Rule: A page reports what it holds

    @unit
    Scenario: The last page reports how many people it actually carries
      Given a hundred people were asked for and only five remain
      When the provider reads that page
      Then the page says it holds five
      And it carries five people

    @unit
    Scenario: A full page reports the whole page
      Given a hundred people were asked for and a hundred remain
      When the provider reads that page
      Then the page says it holds a hundred

    @unit
    Scenario: The total is the whole directory, never the page
      When a provider reads any single page of a five thousand person directory
      Then the total says five thousand
      And the total counts everybody the filter matched, not everybody returned

    @unit
    Scenario: A start past the end of the directory is an empty page, not a failure
      When a provider asks for people starting past the last of them
      Then the answer is a page carrying nobody
      And it still says how many people there are, so the provider knows it has arrived at the end

    @unit
    Scenario: A provider that advances by what it was told lands on the end exactly
      Given a provider advances by the count each page reports
      When it walks a directory whose size is not a multiple of the page
      Then it stops on the last person rather than before them

  # ── A question we cannot answer is refused ─────────────────────────────

  Rule: A filter is honoured or refused, and never quietly dropped

    @unit
    Scenario: A filter on something we do not support is refused
      When a provider lists people filtered by an attribute we cannot match on
      Then the request is refused as an invalid filter
      And nobody is returned

    @unit
    Scenario: An unsupported filter never widens into the whole organization
      Given a provider looks a single person up by an attribute we do not support
      When the filter cannot be honoured
      Then it does not receive five thousand people with that person somewhere among them
      And it cannot mistake the first person returned for the one it asked about

    @unit
    Scenario: Looking somebody up by their sign-in address still works
      When a provider lists people filtered by the address it knows them by
      Then only that person is returned
      And the match ignores the case the address was written in

    @unit
    Scenario: Looking somebody up by the directory's own identifier works
      Given the directory knows "sam" by an identifier of its own on "okta-primary"
      When a provider lists people filtered by that identifier
      Then only "sam" is returned
      And an address change never breaks this lookup, because the identifier is what the directory means

    @unit
    Scenario: One connection cannot find another connection's person by identifier
      Given "entra-contractors" knows somebody by the same identifier "okta-primary" uses for "sam"
      When "okta-primary" looks that identifier up
      Then it finds its own "sam" and never the other connection's person

    @unit
    Scenario: A filter matching nobody is an empty page rather than a refusal
      When a provider filters by an address nobody in "acme" holds
      Then the answer is a page carrying nobody
      And the total says nobody matched

    @unit
    Scenario: A group filter follows the same rule as a person filter
      When a provider lists groups filtered by an attribute we cannot match on
      Then the request is refused as an invalid filter
      But filtering by the group's display name still answers with that group alone

    @unit
    Scenario: A refused filter says which filter was refused and nothing else
      When a provider sends a filter we cannot honour
      Then the refusal names the filter it could not parse
      And it names no person, no address and nothing about who is in "acme"
