Feature: The first-party sign-in and sign-up screens - the auth screens is ours
  As a person arriving at LangWatch signed out
  I need every screen I can touch to be first-party, honest about failures,
  and to offer joining my team before creating a workspace
  So that no journey depends on Auth0-hosted pages and no organization is
  minted that nobody meant to create

  # D13 (ADR-117). The screens render the router's decisions and never
  # contain routing logic: every screen state is keyed by a routing reason
  # code, the same vocabulary the ops surface reads. Ships dark behind
  # IDENTITY_ROUTER_V2 and appears at the enforce flip together with D03.
  #
  #   /auth/signin            email step → routed outcome (picker | redirect)
  #   /auth/signin?local=1    self-hosted break-glass local login
  #   /auth/signup            email → verification → method → join-before-create
  #   /auth/reset[/<token>]   password reset request + completion
  #   /auth/verify/<token>    verification states (sent · verified · expired)
  #   /invite/<code>          invitation acceptance (logic from D11)
  #   /auth/join              join-before-create interstitial (content from D12)
  #
  # Unified email-first funnel: logging in and signing up are ONE flow, and a
  # dead end in either converts to the other door rather than refusing. Signing
  # up with an address that already has an account quietly becomes logging in;
  # a password typed for an address nobody holds becomes a sign-up, confirmed
  # by email. The account-existence no-oracle is therefore retired at the
  # SCREEN level (ADR-117 §6, Revision 2026-08-24): the router decision stays
  # existence-independent, and the picker still renders the same methods for
  # any address, because both are instance and organization data.
  #
  # Anchors that keep holding on the new screens:
  # specs/auth/sign-in-failure-messages.feature (failures say why),
  # specs/auth/signup-does-not-strand-an-account.feature (half-created
  # accounts stay reachable; sign-up may say an email is registered - the
  # no-oracle invariant is scoped to sign-in and reset, epic Q12).

  Background:
    Given the identifier-first router and screens are enforced

  # ── Sign-in ────────────────────────────────────────────────────────────

  @integration
  Scenario: The email step renders the routed outcome
    When I enter my email on the sign-in screen
    Then a domain-routed decision sends me to my identity provider
    And any other decision shows the method picker the decision named

  # Scoped to the PICKER, which is instance and organization data: the methods
  # offered, and the one request that fetches them, cannot differ by address.
  # What happens after a method is used may converge to the other journey, and
  # the two scenarios below say so.
  @integration
  Scenario: The picker looks the same whether or not my account exists
    When two visitors enter a registered and an unregistered email
    Then both see the same picker, with the same methods, from the same one request
    And the picker itself says nothing about whether an account exists

  @integration
  Scenario: A deny decision explains itself in words from the registry
    When my sign-in is refused with a routing reason code
    Then the screen shows the customer copy registered for that code
    And the screen never shows the code itself or an internal error

  # The no-loop and IdP-sign-out recovery guarantees stay owned by
  # specs/auth/sso-wrong-provider-recovery.feature; this screen renders them.
  @integration
  Scenario: Wrong-method guidance points at the method my account holds
    Given my account belongs to my organization's SSO provider
    When I try to sign in with a different method for the same email
    Then the screen names my organization's sign-in method as the way in

  # A pending conditional-mediation request is supposed to be invisible, but a
  # third-party passkey provider (1Password) answers it with its own unlock
  # sheet the moment it starts. Opening the page must therefore not start one:
  # somebody who came to read the page owes it no ceremony. And the page
  # focusing the field ITSELF is not the person reaching for it — the offer
  # waits for a click or a keystroke.
  @integration
  Scenario: The passkey offer waits until I reach for the address field
    Given this deployment offers passkeys
    When the sign-in screen opens
    And the entrance focuses the address field for me
    Then no passkey request has started
    When I click into the field or start typing my address
    Then the passkey offer starts, once, and never again for this visit

  # ── The device is being asked, and the card says so ────────────────────
  #
  # A WebAuthn ceremony hands the screen to the browser and the operating
  # system, and it can take a while: the prompt may want a fingerprint, a
  # security key that is still in a pocket, or a phone across the room. A
  # spinner on the button says none of that. It says "we are working", which
  # is false — we are not, the device is — and it leaves the person staring at
  # a rail of other methods wondering whether to click one.
  #
  # So the card MORPHS, the way it morphs between the address step and the
  # method step: one dedicated state that names what is being waited on,
  # admits whose prompt it is, and keeps both ways out visible.

  @integration
  Scenario: A ceremony in flight becomes a state of the card, not a spinner on a button
    Given this deployment offers passkeys
    When I ask to sign in with a passkey
    Then the card shows a waiting state titled for using my passkey
    And the methods I did not choose are not left sitting under a spinner

  @integration
  Scenario: The waiting state admits the prompt is not ours
    When the card is waiting for my device
    Then it says the prompt belongs to my browser or operating system
    And it says the prompt may appear on another device
    And it never claims LangWatch is doing anything

  @integration
  Scenario: Both ways out are on the waiting state
    When the card is waiting for my device
    Then I can cancel
    And I can ask for a different way in
    And cancelling returns me to the methods with nothing reported as failed

  @integration
  Scenario: A device that never answers is told the truth
    Given the card has been waiting for my device longer than a ceremony takes
    Then it says we did not hear back from the device
    And it offers to try again and to use another method
    And it does not call this a failure of mine

  # The conditional request is an OFFER nobody started (ADR-120), so it owes
  # nobody a progress report — and a panel appearing over a page somebody came
  # to read is exactly the ambush the gesture rule already exists to stop.
  @unit
  Scenario: The passkey offered from the address field never draws a waiting state
    Given a passkey is being offered from the address field itself
    Then no waiting state is drawn for it
    And nothing about the card changes while it waits

  # Where that silence ENDS. Owing nothing to an offer nobody started is right
  # until somebody picks a credential — from that moment they have started
  # something and are waiting for a door to open, and a refusal they never see
  # is indistinguishable from a dead control. Reported from a live stack: a
  # passkey the server no longer held was refused exactly as it should be, and
  # the screen said nothing at all.
  @integration
  Scenario: A passkey I picked that cannot be used says so
    Given a passkey is being offered from the address field itself
    When I pick one and it cannot be used
    Then the card says so in the same place its other passkey refusals appear
    And I am not sent anywhere

  # A decline is not a failure, and the browser reports it the same way it
  # reports "nothing matched" — so neither may reach the reader.
  @integration
  Scenario: Dismissing the passkey sheet is not a failure
    Given a passkey is being offered from the address field itself
    When I dismiss the sheet instead of picking one
    Then nothing is said about it

  # The opposite of the castle's rule, and worth stating so nobody reads one
  # for the other: the snake is pinned ABSENT under reduced motion, and this
  # glyph is pinned PRESENT and STILL.
  @integration
  Scenario: The waiting glyph stops breathing when less motion is asked for
    Given less motion has been asked for
    When the card is waiting for my device
    Then the glyph is on screen and does not move
    And every word of the waiting state is still there

  # ── Sign-up ────────────────────────────────────────────────────────────

  # The address is confirmed BEFORE anybody gets in (ADR-117 §6).
  #
  #   address -> password or passkey -> account, link sent -> confirm -> in
  #
  # The account is created by the credential step, because a passkey cannot be
  # enrolled against an account that does not exist yet. What that step does
  # NOT do is open a session: the emailed link opens the first one. So an
  # account whose address was never confirmed is an account nobody has ever
  # signed into, which is the property the whole order exists to hold.
  @integration
  Scenario: Sign-up creates the account but does not let me in until I confirm
    When I sign up with my work email and choose a password
    Then my account is created
    But I am not signed in
    And the screen tells me to open the link we sent to that address

  @integration
  Scenario: Opening the link is what signs me in for the first time
    Given I signed up and have not opened the confirmation link
    When I open the link
    Then my address is confirmed
    And I can sign in with the method I chose

  # The link goes out from the call that CREATES the account, not from the
  # screen. The screen has no session to send from - that is the point of the
  # order above - and the only other way to send is a public "mail this
  # address" endpoint, which is a mailer pointed at anything anybody types.
  @unit
  Scenario: The confirmation link is sent by the call that creates the account
    When my account is created
    Then the confirmation link is sent to the address it was created for
    And a mailer that is down does not cost me the account

  # An address whose domain its organization routes through an identity
  # provider must never reach a password box on THIS screen: the account is
  # made at the provider, and a password created here is the exact thing the
  # connection exists to prevent. Sign-up asks the same router sign-in asks,
  # which already ranks a live domain connection above "no account yet".
  @integration
  Scenario: Sign-up hands a single-sign-on domain to its provider
    Given my organization routes my email domain through its identity provider
    When I enter my work email on the sign-up screen
    Then I am handed to that provider
    And I am never offered a password or a passkey for that address

  # A passkey is a way to CREATE an account, not only a way back into one
  # (Passkey Central, "New account creation with a passkey"). The credential
  # step offers both, and the passkey sits above the password fields because it
  # is the better thing to leave with — beside them rather than in front of
  # them, so declining costs a glance and the other way on is already drawn.
  #
  # Creating the account only once the ceremony succeeds is what keeps an
  # abandoned attempt free: asking for options writes nothing down.
  @unit
  Scenario: Signing up with a passkey creates the account and the session together
    Given I have typed an address that has no account
    When I create a passkey instead of choosing a password
    Then my account is created and the passkey belongs to it
    And I am signed in without a second system prompt
    And a confirmation link is sent without my having to wait for it

  # THE one that matters. Registration without a session is what lets somebody
  # sign up with a passkey at all, and the same opening would otherwise let
  # anyone attach their own passkey to anybody's account by naming the address.
  @unit
  Scenario: A passkey is never registered against an address that already has an account
    Given the address I named already has an account
    When a passkey registration is started for it
    Then it is refused before any ceremony begins
    And no system prompt opens for it

  @unit
  Scenario: Declining the passkey leaves the password fields where they were
    When I dismiss the passkey prompt
    Then nothing is reported as having gone wrong
    And I can still finish by choosing a password

  # ── A new account is asked for a credential before anything is mailed ──
  #
  # The order above — address, then credential, then the link — was built on
  # the sign-up door and only there. The LOG-IN door kept the older order on
  # both of its conversion paths: an address the router did not recognize, and
  # a password typed for an address that turns out to hold no account. Both
  # mailed a confirmation link straight from the address and asked for a
  # credential afterwards, on the screen the link lands on.
  #
  # That is the wrong way round for two reasons. The mail goes out before
  # anybody has committed to anything, so a mistyped address costs a stranger
  # a message and costs us a send; and it puts somebody on a "check your email"
  # screen as their first experience of the product, with the thing that would
  # have finished the job — choosing a password — still one round trip away.
  #
  # `requestSignUpVerification` says as much in its own contract: it is the
  # RESEND, for a link that expired or never arrived, and sign-up "no longer
  # calls this". The two log-in paths were still calling it as a start.
  @integration
  Scenario: No confirmation link is sent until a credential has been chosen
    Given I enter an address nobody holds an account for
    When the screen offers to create an account with it
    Then it asks for a password or a passkey before anything is sent
    And no confirmation link has gone out while I am still choosing
    And the account and the link are made by the same call, as on the sign-up door

  # The one thing the log-in door must NOT do on the way is bank the password
  # that was typed at it. That field is spelled `current-password`, is asked
  # for once, and is held to no length — an account created from it could be
  # made two ways, and the log-in way took a single character.
  @integration
  Scenario: Converting at the log-in door still asks for the password properly
    Given I submitted a password for an address that holds no account
    When the screen becomes the credential step
    Then the password I typed at the log-in door is not carried into it
    And I choose one there, typed twice and held to a length

  # A passkey ceremony started from a SIGN-UP screen is a discoverable-
  # credential request: the browser offers every passkey it holds for this
  # site, and picking one signs that account in. On a screen whose whole
  # purpose is to make a NEW account that is not an alternative way to finish
  # the journey — it is a way to silently end up somewhere else, signed in as
  # somebody the person was not trying to be. Worse, it looks like it worked.
  #
  # So the sign-up door offers passkeys the only way that means what it says:
  # creating one, on the credential step, against the address being registered.
  # Somebody who already has an account and a passkey is not stranded — the
  # log-in door is one link away and carries the address they typed.
  @integration
  Scenario: The sign-up door never offers to use a passkey that already exists
    Given this deployment offers passkeys
    When I am on any step of creating a new account
    Then no way in offers to use a passkey I already hold
    And the passkey it does offer creates a new one for the address I am registering
    And the way to the log-in door is on the card, so nobody with one is stranded

  # The address is the only personal data on these screens, and a query string
  # is written down by every hop it passes: access logs, proxies, error
  # reports, and the `Referer` of whatever is loaded next. The fragment is the
  # one part of a URL the browser keeps to itself.
  @unit
  Scenario: An address carried between the two screens never reaches the server
    Given I typed my address on the log-in screen
    When I follow the link to sign up instead
    Then the address is carried in the URL fragment, not the query
    And the sign-up screen prefills it and takes it back out of the address bar

  # An ADDITIONAL address is not a gate, and this is the one place the two
  # rules meet. The address somebody SIGNED UP with is confirmed before they
  # get in, above. A second address is only ever asked about: the platform
  # already holds a confirmed address for this person, so an unconfirmed extra
  # one blocks nothing and is nudged from inside the app.
  @integration @unimplemented
  Scenario: A second address is nudged, never gated
    Given I am signed in and have added a second email address
    Then I can use the platform with the second address unconfirmed
    And the app tells me it is unconfirmed, with a way to send the link again

  # The interstitial's CONTRACT ships with D13 and is bound below (verified
  # email in, decision out, nothing rendered when there is nothing to offer).
  # Which organizations will take an address, and the words that go with them,
  # are D12's - so this stays parked until D12 fills the seam.
  @integration
  Scenario: Sign-up offers my team before offering a new workspace
    Given my verified domain matches an organization that allows joining
    When I complete verification
    Then joining that organization is the leading action
    And creating a new organization is the explicit secondary choice

  @integration
  Scenario: With no match, sign-up proceeds to workspace creation
    Given my verified domain matches no organization
    When I complete verification
    Then the interstitial renders nothing and I continue to create a workspace

  # ── No dead ends: the two doors converge ───────────────────────────────

  @integration
  Scenario: Sign-up with an address that already has an account becomes a log-in
    Given I start signing up with an address that already has an account
    When the address step resolves
    Then the page becomes the log-in step with my address already in it
    And no notice, banner or refusal about an existing account is shown

  @integration
  Scenario: Signing in without an account creates it through verification
    Given I enter an address nobody holds an account for
    When I submit a password on the log-in screen
    Then the screen becomes the credential step for a new account with that address
    And a wrong password for an address that does have one still says so

  # The password is chosen ONCE, on the screen the confirmed link lands on,
  # where it is typed twice and held to a length. The log-in form's password
  # field is spelled `current-password` and asked for once; banking whatever
  # was typed into it meant the same account could be created two ways, and
  # the log-in way took a single character and never asked twice.
  @integration
  Scenario: A password typed at the log-in door never becomes an account's password
    Given I enter an address nobody holds an account for
    When I submit a password on the log-in screen
    Then only my address is carried into the sign-up
    And I choose my password again on the credential step, like every sign-up

  # The commonest reason to be staring at "check your email" is that the
  # address on it is wrong. The step lives in memory rather than in the URL,
  # so the browser's own back button is not a way out of it.
  @integration
  Scenario: Going back from a sent link returns to the address step
    Given a confirmation link has been sent to the address I typed
    When I say the address was wrong
    Then I am returned to the address step, not to the password step
    And the link that went out simply expires unopened

  # ── The screens are one surface ────────────────────────────────────────

  # Supersedes "badged, never reordered". That rule was right while every
  # address saw the same instance-wide list — reordering it by a local hint
  # would have made the screen differ per browser while the decision behind it
  # did not. The list is the ACCOUNT's now (ADR-117, revision 2026-08-25), so
  # promoting the method that account last used is the screen agreeing with
  # itself rather than diverging from the server.
  @integration
  Scenario: The method last used on this device leads, and is badged
    Given I signed in on this browser before
    When the picker renders the methods my account holds
    Then the method I used is first, and badged as the last one used
    And every method below it stays in the order the decision named

  @integration
  Scenario: A local hint never overrules the deployment's own ranking
    Given this browser remembers a method my account no longer holds
    When the picker renders
    Then nothing is promoted and nothing is badged
    And the methods stay in the order the decision named

  # ── The address decides which journey this is ──────────────────────────

  @integration
  Scenario: An address with no account carries on as a sign-up
    When I enter an email address no account holds
    Then the screen says so and offers to create an account with that address
    And the address is carried, so I type it once
    And it asks for a password or a passkey, the way the sign-up door does
    And finishing lands me on the same "check your email" the sign-up door shows
    And I can go back to the address step for a mistyped address

  @integration
  Scenario: An account with a passkey is asked for it, not offered a button
    Given my account holds a passkey
    When I submit my email address
    Then the passkey ceremony starts, because submitting was the gesture
    And the waiting state is the card, not a spinner on a button
    And a method set that is the instance's rather than my account's starts nothing

  @integration
  Scenario: A declined passkey falls back to the next method, and does not ask again
    Given my account holds a passkey and a password
    When I close the passkey prompt
    Then the card offers my password, with the passkey there to try again
    And no second ceremony is started for me

  # A system sheet sits over the page, and a live rail underneath it invites a
  # second hand-off on top of the first. The restore is the load-bearing half:
  # it happens on every way a ceremony can end, not on the ones somebody
  # remembered to write.
  @integration
  Scenario: The rest of the rail stands back while a ceremony runs
    Given a passkey ceremony is running
    Then the method it started from shows it is working and takes no second press
    And every other way in stands back, dimmed and unclickable
    And a card that draws its rail throughout shows the waiting state instead
    When the ceremony ends, however it ends
    Then every method is enabled and undimmed again
    And a ceremony that never answers can still be cancelled

  @integration
  Scenario: The address and password fields cooperate with password managers
    When I move from the address step to the method step
    Then the address is still in the form, spelled as a username
    And the password field says whether it is a current or a new password

  @integration
  Scenario: A rejected field says what to fix, next to the field
    When a value I typed is refused
    Then the complaint appears next to the field that caused it
    And it says what to change rather than that something went wrong

  @integration
  Scenario: A rate-limited log-in says how long, and stops asking
    Given the installation has stopped accepting attempts for now
    When my sign-in is refused for it
    Then the screen says how long is actually left, from the answer it got
    And the submit stands down until the wait is over

  # The surrounding panel is the hosted product's case, and it is composed
  # AROUND the card rather than into it: the component that authenticates a
  # person is the same one on every installation, and an installation with
  # nothing to sell renders none of it. Below the split it collapses to the
  # headline, because a tagline and a logo row above a log-in form on a phone
  # are two screens of scrolling in front of the thing the person came to do.
  @integration
  Scenario: The hosted auth screens makes its case beside the card, never inside it
    Given a hosted deployment
    When the auth screens renders
    Then the headline and its tagline stand in their own panel beside the card
    And a company's own installation shows the card with nothing beside it

  # The slot under the tagline stays EMPTY, deliberately. The thing that
  # belongs there is a customer — a quote or a logo row — and both are
  # somebody else's decision to be named, so neither can be written by us. A
  # row of integration marks was tried there and is the wrong module for this
  # page: it argues that we are compatible, when the question a stranger is
  # actually asking is whether anybody else trusts us. An empty slot beats
  # furniture, and the panel already renders nothing when nothing is passed.
  @integration
  Scenario: The case panel claims nothing it has not been given
    Given a hosted deployment
    When the auth screens makes its case beside the card
    Then the panel shows the headline and its tagline
    And it shows no customer's mark, no vendor's mark and no borrowed trust

  # The card is live from the first frame; the entrance only decides what is
  # painted while the first keystroke is being typed, and when focus is taken.
  @integration
  Scenario: The entrance plays once, and never in front of a keystroke
    When the auth screens paints for the first time after the loading screen
    Then the mark it was showing arrives in the card and the rows rise behind it
    And it plays once for the page, not once per screen
    And nothing moves at all when less motion has been asked for

  # ── Password reset and verification states ─────────────────────────────
  # The reset flow's no-oracle response and revoke-all-sessions guarantees
  # stay owned by specs/auth/password-reset.feature; the half-created-account
  # recovery stays owned by specs/auth/signup-does-not-strand-an-account.feature.
  # Both anchors bind to the new screens unchanged.

  # Bound at the screen, which is where the deployment used to decide: the
  # reset is offered on an installation that signs in through a provider, and
  # the response is the same neutral sentence either way. That the reset then
  # completes, revokes every session and expires after one use is
  # password-reset.feature's, bound there and unchanged by the flip.
  @integration
  Scenario: Reset follows the identifier, not the deployment mode
    Given my account holds a password identifier on a cloud installation
    When I request a password reset
    Then the reset completes and my sessions are revoked
    And the reset link is single-use and expires

  # The reset pair were the last two screens still built out of the app's own
  # settings furniture — a bordered panel, title-cased labels with helper
  # lines under them, an orange button. Somebody who has just failed to get in
  # is the LAST person who should be made to wonder whether they are still on
  # the same site.
  @integration
  Scenario: The reset screens are the same card as every other auth screens screen
    When I open the forgot-password screen or the reset screen
    Then it is the same card, on the same ground, in the same theme
    And the fields, the labels and the button are the ones the log-in screen uses

  @integration
  Scenario: The reset screens morph rather than replacing themselves
    Given I am on the forgot-password screen
    When the link goes out
    Then the card becomes the same "check your email" the other doors show
    And nothing about the page around it is repainted

  # The screen used to render whatever sentence came back from the endpoint.
  # Since #5984 that sentence is a code slug, so the person read one of those.
  @integration
  Scenario: A refused reset says why in words from the registry
    When the reset endpoint refuses what I submitted
    Then the screen shows the copy registered for the code it answered with
    And the screen never shows the code itself or a raw message
    And a refusal that is not about the link leaves the form live

  @integration
  Scenario: An expired verification link offers a resend, nothing else
    When I open an expired verification link
    Then the screen says the link expired and offers to send a fresh one
    And the expired token verifies nothing

  # A LINK OPENED TWICE IS NOT A LINK THAT EXPIRED, and saying so was the
  # single most common way this screen lied. Spending the token deleted its
  # row, so the second visit could not tell "you used this a moment ago" from
  # "this was never issued" and called both expired — to somebody holding a
  # link that had just arrived and had just worked. What follows is a person
  # pressing "send a fresh one" over and over at a screen that had already
  # done its job.
  #
  # A second opening asks the same question and deserves the same answer: the
  # address is confirmed. Nothing is created twice — the row is marked spent
  # rather than deleted, so it can never confirm or create anything again —
  # and the grace window means a link stays honest for as long as it is
  # plausibly still in somebody's inbox.
  @unit
  Scenario: Opening a confirmation link a second time confirms, rather than refusing
    Given I opened my confirmation link and my address is confirmed
    When I open the same link again
    Then the screen carries on as though it had just worked
    And nothing is created a second time

  @unit
  Scenario: A spent link stops working once its grace window closes
    Given I opened my confirmation link long enough ago that it is past its grace
    When I open the same link again
    Then the screen says the link expired and offers to send a fresh one

  @unit
  Scenario: A link nobody ever issued is refused the way an expired one is
    When I open a confirmation link that was never issued
    Then the screen says the link expired and offers to send a fresh one
    And the answer never says whether that link was ever issued

  # The identifier-verification LANDING never spends the link — a mail scanner
  # following it must consume nothing — so it cannot learn that a token is
  # dead. What it can know without asking anybody is that no token arrived.
  @integration
  Scenario: An incomplete verification link says so, and still verifies nothing
    When I open a verification link that carries no token
    Then the screen says the link is incomplete and what to do about it
    And it does not send me back to a window that could not finish the job
    And it makes no request of any kind

  # ── The second factor ──────────────────────────────────────────────────

  # There was no screen at all before this: a correct password on an enrolled
  # account answered with a challenge nobody asked for, and the browser was
  # sent to a page it held no session for. The rules underneath are D06's, in
  # mfa-and-session-shape.feature; these are the screen's.
  @integration
  Scenario: A correct password with a second factor asks for the code on the same card
    Given my account has two-step verification set up
    When I sign in with the right password
    Then the same card asks for my authenticator code
    And the ground moves with it, the way it does between every other step
    And answering correctly takes me where I was going

  @integration
  Scenario: The challenge screen never says whether backup codes exist
    Given I am being asked for a verification code
    Then a backup code is offered as an alternative to everybody who gets here
    And nothing on the screen says how many I hold, or whether I hold any
    And a wrong authenticator code and a wrong backup code are refused alike

  @integration
  Scenario: A refused code says why in words from the registry
    When the code I enter is refused
    Then the screen shows the copy registered for the code it answered with
    And the screen never shows the code itself or a raw message
    And the box is cleared, because the next code is a different number

  @integration
  Scenario: Cancelling the challenge goes back without signing anybody in
    Given I am being asked for a verification code
    When I cancel
    Then no session is minted and nothing is verified
    And I am back at the log-in card

  # ── Every remaining unauthenticated screen is the same surface ─────────

  # Each of these was still the app's own furniture — a grey setup layout, a
  # bordered panel, a logo beside a title-cased heading, an alert filling the
  # body — on journeys that begin and end on the auth screens' card.
  @integration
  Scenario: The sign-in error screen is the same card as the door it came from
    When a sign-in fails for a reason I have to act on
    Then the refusal is on the auth screens' card, on the auth screens' ground
    And the words and the recovery action are the ones it always offered
    And the error code from the query string is never shown to me

  @integration
  Scenario: The invitation and join screens stand on the same ground
    When I open an invitation link or reach the join-before-create step
    Then the card and the ground are the ones every other auth-screen screen uses
    And an invitation link with no code in it says so without naming an organization

  # The gel has been removed twice and came back twice, because nothing said it
  # could not. The website fills its actions with flat brand colour and lets
  # the colour carry the message; a top-lit gradient with an inner highlight is
  # a different decade's idea of a button.
  @integration
  Scenario: The primary action is a flat brand fill, not a gel button
    When any door draws its primary action
    Then it is solid brand orange with no gradient, highlight or glow
    And hover darkens it one step along the brand ramp, changing nothing else
    And pressing it gives half a pixel, and focus draws the brand's ring
    And it never grows or lifts when pointed at

  @integration
  Scenario: The card has one radius language
    When a card draws a field and a button together
    Then both are cut to the same radius
    And no control on the card is a full pill while its neighbours are not
    And every door draws that button from one definition, never a copy

  @integration
  Scenario: A stage in flight says so in place
    When I submit an address, a password or a code
    Then the button keeps its label and shows it is working
    And the field it belongs to stops taking edits until there is an answer
    And nothing on the card jumps or empties while it waits

  @integration
  Scenario: Every stage offers the other door
    When I am on any step of either door
    Then the way to the other one is on the card
    And it carries the address I already typed

  # ── Invitation acceptance (renders D11's rules) ────────────────────────

  @integration
  Scenario: An invite landing shows who is asking and every way in
    When I open a valid invite link signed out
    Then I see the organization, the inviter, and the method picker
    And signing in or signing up carries the invite through untouched

  @integration
  Scenario: A signed-in visitor confirms and joins
    Given I am already signed in with a verified identifier matching the invite
    When I open the invite link
    Then I am asked to confirm joining, and confirming makes me a member

  @integration
  Scenario: An expired invite offers to ask for a new one
    When I open an expired invite link
    Then the screen offers to ask the inviter for a fresh invitation
    And a revoked invite ends the journey without naming details

  # ── The surface is ours ────────────────────────────────────────────────

  # Swept over the ENFORCED screens only, on purpose: the legacy path still
  # exists until the bake ends and still redirects to whatever provider the
  # deployment names, so sweeping it would fail on behavior the flag is meant
  # to keep. An identity provider is reached by dialling it from our own
  # origin; its pages are never rendered or linked.
  @integration
  Scenario: No unauthenticated journey touches an Auth0-hosted page
    When every unauthenticated journey is walked
    Then no page, asset, or redirect resolves to an Auth0-hosted surface

  @integration
  Scenario: The legacy screens return untouched when the flag is off
    Given the flag is turned off during the bake
    When the sign-in page is requested
    Then the legacy screens answer exactly as before the flip
