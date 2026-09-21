# Control: GAC-10.
Feature: An organization can bound how long a signed-in session lasts
  As an organization administrator answerable for the machines our people
  leave unlocked
  I want a session to end after a period of inactivity rather than after a
  month
  So that an unattended browser stops being a way in, and so that I can show
  what our sessions are actually bounded by

  # WHAT ALREADY EXISTS AND IS NOT THIS.
  #
  # `Organization.maxSessionDurationDays` bounds CLI and device sessions, and
  # is enforced when the CLI refreshes. It does not touch browser sessions and
  # never has. A browser session today is thirty days, rolling, with no idle
  # timeout of any kind. This feature is about the browser, and it deliberately
  # leaves the CLI knob alone: two surfaces, two lifetimes, two decisions an
  # administrator makes separately.
  #
  # TWO NUMBERS, NOT ONE. "Valid for one hour and refreshed every hour"
  # describes a rolling window: activity keeps you in, an idle hour puts you
  # out. That is the IDLE timeout, and it is the one the control needs. The
  # second number - an absolute ceiling from the moment you signed in, which no
  # amount of activity extends - is offered beside it because an auditor
  # reading "the session must be valid for one hour" literally will ask for it,
  # and because a session that can be kept alive forever by a page that polls
  # is not really bounded at all.
  #
  # OFF UNLESS AN ORGANIZATION ASKS, like every other rule on this page.
  #
  # STRICTEST ORGANIZATION WINS. A person has one browser session and may
  # belong to several organizations, so the session cannot expire
  # per-organization. The tightest window among their memberships bounds the
  # whole session - including their personal workspace. This is the one place
  # this feature is less kind than the two-step requirement, which deliberately
  # strands nobody's personal workspace; a session is a single object with a
  # single expiry and there is no honest way to have it be two lengths at once.
  # Said in a scenario below so it is a decision on the record.

  Background:
    Given an organization "acme" whose administrator "ana" may manage it
    And "sam" is a member of "acme"

  Rule: an organization that never configures this changes nothing

    @unit
    Scenario: No window means the session behaves as it always has
      Given "acme" has never set a session window
      When "sam" leaves his browser untouched for a week
      Then he is still signed in
      # An installation that does nothing sees no change at all, which is
      # what makes this safe to ship to every customer at once.

    @unit
    Scenario: An organization made from now on starts with a day
      Given an organization created after this rule existed
      When nobody has opened the sign-in security card
      Then its sessions end after a day of inactivity
      # NEW ORGANIZATIONS ONLY. The column is added at zero, so every
      # organization that already existed keeps "no rule" and nobody is
      # signed out on deploy; the day is the default only for rows written
      # afterwards. A day ends the browser left open on a train without
      # troubling anybody working normally.

    @integration
    Scenario: The window is offered with the numbers the control asks for
      When "ana" opens the sign-in security card
      Then an idle timeout is offered starting at one day
      And a maximum session length is offered, which she may leave unset
      And it says plainly that saving it will sign out anybody already idle

  Rule: an idle session ends

    @unit
    Scenario: An hour of nothing ends the session
      Given "acme" ends idle sessions after one hour
      And "sam" last used LangWatch seventy minutes ago
      When his browser asks for anything at all
      Then he is not signed in
      And the session is destroyed rather than merely refused
      # Destroyed, because a session that is refused in one place and honoured
      # in another is not ended. The cached copy goes with the row.

    @unit
    Scenario: Using it keeps it alive
      Given "acme" ends idle sessions after one hour
      When "sam" uses LangWatch every half hour all afternoon
      Then he is never signed out
      # The "refreshed every hour" half. A window that expires regardless of
      # activity is a maximum session length, which is the other setting.

    @unit
    Scenario: A maximum length is not extended by activity
      Given "acme" caps a session at eight hours
      When "sam" works continuously for nine
      Then he is asked to sign in again
      # The difference between the two numbers, in one scenario.

  Rule: the person is told why, and lands somewhere useful

    # NOT BUILT YET, and tagged so rather than tagged as bound. The bound
    # itself is enforced - a session past its window is ended everywhere - but
    # the person currently arrives at an ordinary sign-in screen with no word
    # about why, and lands wherever the screen sends them. Saying why needs
    # something to carry the reason across a sign-out that has just destroyed
    # the only thing we could have carried it on, and that is a piece of
    # design rather than a line of copy.

    @unimplemented
    Scenario: Being signed out for idling says so
      Given "sam" is signed out because his session went idle
      When he arrives at the sign-in screen
      Then he is told his organization ends idle sessions and he can sign
      straight back in
      And he is not shown a failure
      # An expected, configured, correct outcome. Presenting it as an error
      # teaches administrators that their own policy is broken.

    @unimplemented
    Scenario: What he was doing is not lost to the sign-out
      Given "sam" is signed out mid-page because his session went idle
      When he signs back in
      Then he returns to where he was

  Rule: turning it on applies to the sessions already open

    @integration
    Scenario: Saving a window ends the sessions already past it
      Given three of "acme"'s members have been idle for two hours
      When "ana" sets the idle timeout to one hour
      Then those three sessions are ended
      And the members who are working are not interrupted
      # Deliberately unlike the two-step requirement, which ends zero sessions
      # because it is a condition on an account rather than on a session. A
      # session policy that only applied to sessions minted after it was saved
      # would leave a month of thirty-day sessions outliving the decision that
      # was supposed to bound them.

    @unit
    Scenario: A member of two organizations is bound by the tighter one
      Given "sam" belongs to "acme", which ends idle sessions after one hour,
      and to "globex", which sets no window
      When he is idle for seventy minutes
      Then he is signed out of everything, his personal workspace included
      # There is one session. Named as its own scenario because it is the
      # consequence administrators will be surprised by, and it should surprise
      # them here rather than in a support ticket.

  Rule: the two session surfaces stay separate

    @unit
    Scenario: A browser window does not silently bound the CLI
      Given "acme" ends browser sessions after one hour
      And "acme" has never capped CLI sessions
      When a member's CLI refreshes a day-old session
      Then it succeeds
      # An hour-long CLI session would break every scheduled job our customers
      # run, and nobody setting a browser idle timeout is asking for that.

    @unit
    Scenario: A capped CLI does not bound the browser
      Given "acme" caps CLI sessions at seven days
      And "acme" has never set a browser session window
      When "sam" returns to his browser after ten days
      Then he is still signed in
      # The existing setting keeps meaning exactly what it meant.

  Rule: the bound is enforced where the session is read

    @unit
    Scenario: A session past its window is refused on every surface
      Given "sam"'s session is past his organization's idle window
      When that session is presented to the application, to the API and to a
      background request alike
      Then each of them refuses it
      # A check that lives in one page's loader is not a session policy. It has
      # to sit where the session is turned into an identity, which is the one
      # place every surface already goes through.

    @unit
    Scenario: Reading a session costs no more than it did
      When a signed-in request is served
      Then bounding the session adds no further round trip to the database
      # The row is already read on every authenticated request to fail closed
      # on a revoked session. Enforcing a window there is free; enforcing it in
      # a second query would tax every request in the product for a setting
      # almost nobody has turned on.
