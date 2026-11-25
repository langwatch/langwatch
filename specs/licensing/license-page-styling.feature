Feature: The License page says where a license stands

  The License page answers three questions for an admin: what does our
  license cover, is it still good, and how do I get one. It reads the same
  way on every state, and every action stays where the admin looks for it.

  Background:
    Given I am an administrator on the License settings page at /settings/license

  Rule: an installed license is shown as facts, not as a form

    @integration
    Scenario: A valid license shows its plan, seats, expiry and holder
      Given a valid license is installed
      Then I see the plan, the seats in use against the seats bought, the expiry date and who it is licensed to
      And the license is called valid

    @integration
    Scenario: The expiry date fits its tile and keeps the full date on hover
      Given a valid license that expires on 30 September 2099
      Then the expiry tile reads "Sep 30, 2099", never cut short
      And hovering it shows "September 30, 2099"

    @integration
    Scenario: Seats in use are drawn against the seats bought
      Given a valid license covering 100 seats with 4 in use
      Then the seats tile draws a meter filled to 4 percent

    @integration
    Scenario: Unlimited seats are not drawn as a meter
      Given a license whose seats are unlimited
      Then the seats tile says Unlimited
      And it draws no meter

    @integration
    Scenario: A finite Lite seat limit is shown next to the seats
      Given a valid license covering 50 Lite seats with 3 in use
      Then a Lite seats tile shows 3 of 50, right after the seats tile

    @integration
    Scenario: Unlimited Lite seats are not shown
      Given a license whose Lite seats are unlimited
      Then the page shows no Lite seats tile

    @integration @unit
    Scenario: A license that states no Lite limit shows the one Lite seat it enforces
      Given a valid license signed before licenses stated a Lite seat limit
      Then its status reports a Lite seat limit of 1, the default the seat guards enforce
      And a Lite seats tile shows 0 of 1, so the admin sees why a second Lite invite is refused

    @integration
    Scenario: A license can be removed from the page
      Given a valid license is installed
      Then I can remove the license

    @integration
    Scenario: An unreadable license is named and can be removed
      Given the stored license file cannot be read
      Then the page says the license is corrupted
      And I can still remove it

  Rule: a missing license is an offer, not an error

    @integration
    Scenario: Without a license the page offers two cards, one for a code and one for buying
      Given no license is installed
      Then the page says no license is installed
      And one card is titled "I have an activation code" and holds the activation code field and the Activate button
      And another card is titled "I need a license" and says "You get an activation code when you buy a license."
      And the "I need a license" card offers "Talk to sales"
      And nothing on the page says the code was sent with an order

    @integration
    Scenario: Without a license the page offers three ways to activate one
      Given no license is installed
      Then I can choose an activation code, a license file or a license key inside the "I have an activation code" card

    @integration
    Scenario: Activation waits until something is entered
      Given no license is installed
      Then I cannot activate until I have entered something to activate
      And the page says "Enter an activation code to activate."

    @integration
    Scenario: The reason activation waits follows the chosen form
      Given no license is installed
      When I choose to enter a license key
      Then the page says "Paste a license key to activate."
      When I choose a license file
      Then the page says "Choose a license file to activate."

    @integration
    Scenario: The reason disappears once something is entered
      Given no license is installed
      And I have entered an activation code
      Then I can activate
      And the page no longer says why activation waits

    @integration
    Scenario: Activating with a code hands the code on
      Given no license is installed
      And I have entered an activation code
      When I activate
      Then the code is submitted for activation

    @integration
    Scenario: Switching to a license key shows the key field
      Given no license is installed
      When I choose to enter a license key
      Then I see the license key field

    @integration
    Scenario: A member who cannot manage the organization is told who can activate
      Given I am a member without organization:manage
      And no license is installed
      Then the page says "An organization admin can activate a license."
      And there is no activation code field and no Activate button

  Rule: the License page and the Connect page tell the same sync story

    @integration
    Scenario: A connected license that has synced says when
      Given a valid license that names a hosted service
      And the last license sync succeeded 5 minutes ago
      Then the Sync line reads "Last synced 5 minutes ago"

    @integration
    Scenario: A connected license that has never synced says so
      Given a valid license that names a hosted service
      And no license sync has run yet
      Then the Sync line reads "Not synced yet"
      And it never says "Connected to LangWatch"

    @integration
    Scenario: A failed sync is named on the License page and never reads as connected
      Given a valid license that names a hosted service
      And the last license sync was refused as unreachable
      Then the Sync line says the last sync failed and why
      And it still says when the last successful sync was, or "Not synced yet"

  Rule: a license LangWatch revoked says so

    @integration
    Scenario: A revoked license is not called valid
      Given a license whose signature checks out
      And LangWatch refused the last sync because the license was revoked
      Then the status reads "Revoked by LangWatch: hosted services are off"
      And the license is not called valid

  Rule: a failure to read the license is not a missing license

    @integration
    Scenario: The page offers a retry when the status cannot be read
      Given the license status cannot be read
      Then the page says it is unable to load the license
      And it offers a retry

  Rule: usage against limits is read on the Usage page, not here

    @integration
    Scenario: Each resource's current use is read on the Usage page
      Given I open /settings/usage on a self-hosted installation
      Then each resource shows its current use
      And lite members are included when the plan has them

    @integration
    Scenario: The plan leads the usage tiles
      Given I open /settings/usage
      Then the plan is the first tile, ahead of the usage tiles
