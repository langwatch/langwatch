Feature: Profile - who I am here, and where I am signed in
  As somebody who signs in to LangWatch
  I want one page that says who I am, how I get in, where I am signed in and
  what keys act as me
  So that I can recognise my own account, and spot anything on it that is not
  me

  # /settings/profile, the second page of the YOU section
  # (specs/navigation/settings-shell-v2.feature). Security is its sibling and
  # holds everything about CHANGING how you prove who you are; this page reads
  # it back and changes only the two things nowhere else changes.
  #
  # FOUR BANDS, each a narrower kind of "you" than the one above:
  #
  #   your details ──► sign-in methods ──► where you are signed in ──► your keys
  #
  # ONE MUTATION SURFACE PER SUBJECT. The name and the photo are set here
  # because nowhere else sets them. Addresses, passkeys and passwords are
  # SUMMARISED here and managed on Security; API keys are summarised here and
  # managed on the API Keys page. Two pages that both added an address would be
  # two places for the same refusal to be worded differently. Signing one
  # browser out is the single exception, because it has no other home.
  #
  # The photo already worked, on a page about personal API keys. The name did
  # not: it was rendered read-only beside it, and the only writers of it were
  # sign-up, the identity provider and a back-office operator. So somebody
  # whose directory sent "asmith" was stuck as "asmith" to everyone who ever
  # read a member list.
  #
  # WHAT THE DATA DOES NOT HOLD is not on the page. There is no job title on a
  # person, so none is shown. There is no organization-set session lifetime, so
  # nothing claims one; each browser states its own activity instead, which is
  # known to the nearest day because that is how often a live session's row is
  # rolled.
  #
  # A DIRECTORY-OWNED NAME IS STILL THE READER'S TO SET. The next push may
  # overwrite it, and that is worth saying, but it is not worth refusing: the
  # organization that wants the directory to win already has the directory
  # winning.

  Background:
    Given I am signed in as "Ana"

  # ── Your details ───────────────────────────────────────────────────────

  Rule: the page opens with what everybody else sees

    @integration @unimplemented
    Scenario: The first band is my photo, my name and where I stand
      When I open my profile
      Then I see my photo and my name
      And I see the address my account is reached at
      And I see whether I am an admin of my organization

    @integration @unimplemented
    Scenario: A person with no job title is not given one
      When I open my profile
      Then nothing on it claims a job title

  Rule: a name is mine to change

    @integration @unimplemented
    Scenario: Changing my name saves it
      When I set my name to "Ana Silva" and save
      Then the name is saved
      And every surface that names me says "Ana Silva" without my signing in
      again

    @integration @unimplemented
    Scenario: Save stands down until the name has actually changed
      When I open my profile
      Then Save is not offered
      When I type a different name
      Then Save is offered

    @integration @unimplemented
    Scenario: An empty name is refused before it is sent
      When I clear my name
      Then Save is not offered
      And nothing was sent

    @unit
    Scenario: A blank name is refused at the boundary as well
      When something asks to set my name to whitespace
      Then the attempt is refused
      And my name is unchanged

    @integration @unimplemented
    Scenario: A name that could not be saved says so
      Given saving my name fails
      When I save
      Then I am told it did not save, in words, with a trace to quote
      And the name I typed is still in the field

  Rule: the photo is set where the name is

    @integration @unimplemented
    Scenario: The photo control is on the profile page
      When I open my profile
      Then I can change my photo without leaving the page

  # ── Sign-in methods ────────────────────────────────────────────────────

  Rule: how I get in is read here and changed on Security

    @integration @unimplemented
    Scenario: Each way in is one line
      Given I sign in with an address, a linked account and a passkey
      When I open my profile
      Then each of them is a line saying what it is
      And whether I have a password is one of those lines

    @integration @unimplemented
    Scenario: Nothing on the summary changes anything
      When I open the sign-in methods on my profile
      Then nothing offers to add, rename or remove a way in
      And I am offered the way to Security, where they are changed

    @integration @unimplemented
    Scenario: A deployment that does not offer a thing does not list it
      Given my deployment offers neither passkeys nor two-step verification
      When I open my profile
      Then neither is listed as something I do not have

    @integration @unimplemented
    Scenario: A read that fails says so without taking the band down
      Given the read that says whether I have a password fails
      When I open my profile
      Then my other ways in are still listed
      And I am told what could not be read, in words, with a trace to quote

  # THE SUMMARY MUST NOT CONTRADICT THE CARD ABOVE IT. An account created by a
  # passkey, or one older than the identifier projection, has an address on the
  # account and nothing in the projection — and the summary said it had no
  # address at all, one band under the card showing that very address.

  Rule: the address said here is the address I actually have

    @integration @unimplemented
    Scenario: An account with no identifiers still states its own address
      Given my account signs in by passkey and has never added an address
      When I open the sign-in methods on my profile
      Then the address line says the address my account is reached at
      And it does not say I have none

    @integration @unimplemented
    Scenario: An address I have not confirmed is marked in Security's words
      Given the address on my account has not been confirmed
      When I open the sign-in methods on my profile
      Then it is marked not confirmed yet
      And a confirmed address is marked nothing at all

    @integration @unimplemented
    Scenario: Only an account with no address anywhere is told it has none
      Given my account has no address on it and no identifiers
      When I open the sign-in methods on my profile
      Then the address line says there is none yet

    @integration @unimplemented
    Scenario: The read of my own address failing says so
      Given the read that says what address my account has fails
      When I open the sign-in methods on my profile
      Then I am told what could not be read, in words, with a trace to quote
      And my other ways in are still listed

  # ── Where I am signed in ───────────────────────────────────────────────

  Rule: a browser is named by what it is, not by when it signed in

    @unit @unimplemented
    Scenario: A browser and a machine are read off what the browser sent
      When a session was signed in from a Chrome on macOS
      Then the row reads "Chrome on macOS"

    @unit @unimplemented
    Scenario: Something we do not recognise is not guessed at
      When a session carries a user agent we cannot place
      Then the row says the browser is unknown rather than naming one

    @integration @unimplemented
    Scenario: The browser I am reading this in says so
      When I open my profile
      Then exactly one browser is marked as this one

    @integration @unimplemented
    Scenario: A browser nothing has happened on for a fortnight is pointed at
      Given one of my browsers has done nothing for a month
      When I open my profile
      Then that one carries a chip saying it has not been used lately
      And the chip explains that this is worth a look, not that it is wrong

  Rule: one row ends one session

    @integration
    Scenario: Signing a browser out ends that one and no others
      Given I am signed in on two browsers besides this one
      When I sign one of them out
      Then that one is gone from the list
      And the other two are still there

    @integration @unimplemented
    Scenario: The browser I am reading this in is not offered a sign-out
      When I open my profile
      Then the row marked as this browser carries no sign-out

    @unit
    Scenario: Ending the session doing the asking is refused at the boundary
      When something asks to end the session it is asking from
      Then the attempt is refused with code session_is_current
      And nothing was ended

    @unit
    Scenario: Naming somebody else's session ends nothing
      When something asks to end a session belonging to another person
      Then nothing is ended
      And their session is untouched

    @integration @unimplemented
    Scenario: A sign-out that failed says so
      Given ending a session fails
      When I sign a browser out
      Then I am told it did not happen, in words, with a trace to quote
      And the browser is still on the list

  # ── Your API keys ──────────────────────────────────────────────────────

  Rule: the keys listed are mine

    @integration @unimplemented
    Scenario: An administrator sees their own keys, not the organization's
      Given I am an admin and my colleague also holds a key
      When I open my profile
      Then I see my key
      And I do not see my colleague's

    @integration @unimplemented
    Scenario: A revoked key is not listed as one I hold
      Given a key of mine was revoked
      When I open my profile
      Then it is not in the list

    @integration @unimplemented
    Scenario: The keys are read here and managed on their own page
      When I open my profile
      Then no key can be issued or revoked from it
      And I am offered the way to the page that does both

    @integration @unimplemented
    Scenario: A key read that fails says so
      Given the read of my keys fails
      When I open my profile
      Then I am told what could not be read, in words, with a trace to quote
