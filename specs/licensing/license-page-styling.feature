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
    Scenario: Seats in use are drawn against the seats bought
      Given a valid license covering 100 seats with 4 in use
      Then the seats tile draws a meter filled to 4 percent

    @integration
    Scenario: Unlimited seats are not drawn as a meter
      Given a license whose seats are unlimited
      Then the seats tile says Unlimited
      And it draws no meter

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
    Scenario: Without a license the page offers three ways to activate one
      Given no license is installed
      Then the page says no license is installed and that LangWatch is running open source
      And I can choose an activation code, a license file or a license key

    @integration
    Scenario: Activation waits until something is entered
      Given no license is installed
      Then I cannot activate until I have entered something to activate

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

  Rule: a failure to read the license is not a missing license

    @integration
    Scenario: The page offers a retry when the status cannot be read
      Given the license status cannot be read
      Then the page says it is unable to load the license
      And it offers a retry

  Rule: usage against limits is read on the Usage page, not here

    @integration
    Scenario: Usage against each limit is read on the Usage page
      Given I open /settings/usage
      Then each resource shows its current use against its limit
      And lite members are included when the plan has them

    @integration
    Scenario: The plan leads the usage tiles
      Given I open /settings/usage
      Then the plan is the first tile, ahead of the usage tiles
