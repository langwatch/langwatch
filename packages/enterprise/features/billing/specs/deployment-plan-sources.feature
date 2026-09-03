Feature: One deployment decides one set of plan sources

  Two processes resolve what an organization is allowed: the interactive one
  behind every screen, and the background one that delivers webhooks, settles
  automations and reads captured trace content. They must answer the same thing.
  A background process reading the free baseline where the screen reads a paid
  plan stops delivering a feature the customer is billed for; one reading
  unlimited where the screen reads free gives away what was sold.

  So which baseline a deployment starts from, which paid source is consulted
  over it, and what that source is built from are decided here, once, and each
  process only constructs the entitlement service around the answer.

  @unit
  Scenario: A hosted deployment starts every organization on the free plan
    Given a hosted deployment
    When its plan sources are decided
    Then the baseline is the hosted free plan, with its visibility window and
      its member ceiling

  @unit
  Scenario: A self-hosted deployment starts unlimited
    Given a deployment that is not the hosted one
    When its plan sources are decided
    Then the baseline is the unlimited plan, with no visibility window and no
      member ceiling
    And a subscription row on that deployment still resolves unlimited, because
      the paid source answers the free plan there and a free plan never lifts a
      baseline

  @unit
  Scenario: A paid source exists only where the subscription rows do
    Given a deployment whose process opened no subscription repository
    When its plan sources are decided
    Then no paid source is returned, so the process can name the absence itself
    And a deployment holding the rows resolves a paying organization onto the
      plan its subscription names

  @unit
  Scenario: Every tier entitlement is carried by the plan itself
    Given the entitlements the licensing contract maps to a plan tier
    When a subscription on each of those tiers is resolved
    Then the plan already carries every one of them
    And neither baseline names a tier the map mentions, so no tier enricher is
      threaded through these sources

  @unit
  Scenario: A licensed deployment resolves through its licence
    Given a deployment that composed a licence source
    When its plan sources are decided
    Then the licence is returned as a source, so the entitlement service
      consults it before any other paid one
    And a hosted deployment keeps its subscription source beside it, because a
      licence is the negotiated contract and outranks it rather than replacing
      it

  @unit
  Scenario: A licence predating a tier entitlement still carries it
    Given a signed licence minted before a tier entitlement existed, so the plan
      it names leaves that entitlement unanswered
    When its plan sources are decided
    Then the tier enricher travels with the licence and fills what the licence
      left unanswered, so the deployment that bought the tier is not refused the
      feature the tier sells
    And a deployment that composed no licence source threads no enricher,
      because no other leg can leave a tier entitlement unanswered
