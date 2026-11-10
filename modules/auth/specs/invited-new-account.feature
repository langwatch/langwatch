@auth
Feature: An invited person without an account gets in by any method
  A person opens an invitation link before they have an account. Whichever way they create
  it (a provider, an emailed link, a passkey), they end on the invitation, never on an error
  or on a screen that offers them something other than the invitation they were sent.

  Rule: Starting a provider sign-in twice cannot break it

    # Customer report: two presses on "Continue with Google" about a second apart ended on
    # "Your sign-in expired or was started in another tab", because each start overwrote
    # the one state cookie the provider's callback is checked against.
    @unit
    Scenario: A second press while a provider sign-in is starting joins the first
      Given a provider sign-in has started and the browser is on its way to the provider
      When the same page starts a provider sign-in again
      Then no second sign-in is started
      And the second press answers with the first one's result

    @unit
    Scenario: A provider sign-in that was refused can be started again
      Given a provider sign-in whose start was refused
      When the person presses the provider again
      Then a new sign-in is started

    @unit
    Scenario: A page restored from the back-forward cache can start a provider sign-in again
      Given a provider sign-in started and the person came back with the browser's back button
      When the page is restored from the back-forward cache and the person presses the provider
      Then a new sign-in is started

  Rule: The invitation is where the account creation ends

    @integration
    Scenario: The log-in door's confirmation link carries the invitation
      Given a person on the log-in screen who arrived from an invitation
      When they enter an address with no account and ask for the confirmation link
      Then the link is requested with the invitation as the place to return to

    @integration
    Scenario: The join step sends a person with a waiting invitation to it
      Given a new account whose proven address has an invitation waiting
      When the sign-up reaches the join step
      Then the browser is sent to that invitation
      And no organization is offered and nothing is asked

    @integration
    Scenario: The join step carries on as before when the invitation read fails
      Given the read of waiting invitations fails
      When the sign-up reaches the join step
      Then the join step offers what it offered before

  Rule: A confirmation link that worked never reads as dead

    @unit
    Scenario: A confirmation link is spent once per page, however often the screen mounts
      Given a confirmation link being spent
      When the screen asks to spend the same link again before or after the answer
      Then the server is asked once and both askers get the same answer

    @unit
    Scenario: A refused spend can be asked again
      Given a confirmation link whose spend was refused or never reached the server
      When the screen asks to spend it again
      Then the server is asked again

    @integration
    Scenario: The spent token leaves the address bar
      Given a person opening a confirmation link that carries the invitation
      When the link has been spent
      Then the address bar no longer carries the token
      And it still carries the invitation to return to

    @integration
    Scenario: A spend that never reached the server keeps the token for a reload
      Given a person opening a confirmation link
      When the request to spend it never reaches the server
      Then the address bar still carries the token, so a reload can spend it

    @integration
    Scenario: A reload on the create-your-account step stays on it
      Given a person whose confirmation link brought them to "Create your account"
      When they reload the page
      Then the same step shows for the same address
      And no new confirmation link is asked for

    @integration
    Scenario: A fresh visit to sign-up starts at the address step
      Given a tab holding a confirmed address from an earlier sign-up
      When the person opens the sign-up page again without reloading it
      Then the address step shows
      And the tab no longer holds the earlier address

    @integration
    Scenario: A held proof the server refuses falls back to the address step
      Given a tab holding a confirmed address whose proof was spent or expired
      When the sign-up page loads
      Then it shows the address step
      And the tab holds the proof no longer

    @integration
    Scenario: Creating the account lets go of the held proof
      Given a tab holding a confirmed address
      When the account is created
      Then the tab holds the proof no longer

    @unit
    Scenario: The held proof lasts no longer than the proof itself
      Given a confirmed address held for this tab only
      When it is read after the proof's lifetime, or the browser refuses storage
      Then nothing is held and nothing fails

    @integration
    Scenario: A reopened link in a browser signed in to that account goes on
      Given a browser signed in to the account the link's address now holds
      When the person opens the confirmation link again
      Then the screen says the person is signed in instead of asking them to log in
      And the browser goes on to where the link was taking it

    @integration
    Scenario: A member opening an invitation they already accepted goes in
      Given a person signed in whose invitation was already accepted
      When they open the invitation link again
      Then they are not offered to join again
      And the browser goes on into LangWatch

    @integration
    Scenario: A dead confirmation link in a browser already signed in goes on
      Given a browser that is already signed in
      When a confirmation link it opens is refused as already used
      Then the screen says the person is signed in instead of offering a new link
      And the browser goes on to where the link was taking it
