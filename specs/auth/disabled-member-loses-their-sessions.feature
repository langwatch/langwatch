Feature: Disabling a member ends the sessions they are already holding
  As an administrator revoking someone's seat in an organization
  I want their live browser sessions to stop working at once
  So that revoking access is not merely a note about the future

  # A seat is what an administrator takes away, but a session is what the
  # person is actually working through. Writing `disabledAt` and stopping there
  # leaves them signed in until their token happens to expire — up to thirty
  # days — which is exactly the window an offboarding is trying to close.
  #
  # The revocation follows the membership write rather than preceding it, for
  # the same reason the email-change revocation does
  # (specs/auth/admin-email-change-revokes-sessions.feature): signing someone
  # out first and then failing the write would lock out a member whose seat was
  # never revoked.
  #
  # It is stated here rather than left to the organization feature because the
  # act crosses two owners. Organization decides who holds a seat; Auth owns
  # what a session is and where it is cached. A process that composed one
  # without the other must refuse the disable, not perform half of it.

  Rule: Taking the seat takes the sessions with it

    @unit
    Scenario: Disabling a member revokes their live browser sessions
      Given an active member of an organization
      When an administrator disables that member
      Then the membership is written first
      And every browser session that member holds is revoked

    @unit
    Scenario: Re-enabling a member revokes nothing
      Given a disabled member of an organization
      When an administrator re-enables that member
      Then no browser session is revoked

    @unit
    Scenario: A process without a session owner refuses the disable
      Given a process that composed no session owner
      When an administrator disables a member
      Then the disable is refused rather than half-performed
