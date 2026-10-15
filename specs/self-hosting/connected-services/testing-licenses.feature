Feature: Developer testing licenses
  A developer who needs a license-gated feature on their own stack asks Cloud
  for a testing license. Only Cloud staff with ops permissions can, after
  signing haven in to their Cloud account once. The license is real: signed on Cloud, bound to
  one instance and one local organization, refused once expired. Development
  inside the open-source plan needs no license at all. ADR-180.

  As a LangWatch developer
  I want a short-lived real license for my own stack
  So that I can test gated features without keys or overrides on my machine

  # ============================================================================
  # Seeded local data
  # ============================================================================

  @unit
  Scenario: Seeded local rows get random ids
    When the storage seed creates the local organization, team, project and admin user
    Then each row has a freshly generated id rather than a fixed one
    And two databases seeded separately share none of those ids

  @unit
  Scenario: Seeding again finds the rows it already made
    Given a database the storage seed already ran on
    When the storage seed runs again
    Then it updates the same organization, team, project and admin user by slug and email
    And it creates no second copy of any of them

  # ============================================================================
  # The license itself
  # ============================================================================

  @unit
  Scenario: A testing license carries its kind and its instance
    When Cloud signs a testing license
    Then the signed license says it is a testing license
    And it names the instance and the local organization it was issued for

  @unit
  Scenario: A license with no kind is a standard license
    Given a license signed before testing licenses existed
    When an install reads it
    Then it is treated as a standard license, exactly as before

  @unit
  Scenario: A testing license is refused on another instance or organization
    Given a testing license issued for one instance and one local organization
    When it is uploaded on a different instance, or for a different organization
    Then it is refused with a code naming the mismatch
    And no plan or feature is granted

  @unit
  Scenario: An expired testing license grants nothing, without a restart
    Given an install holding a testing license
    When its expiry passes while the api and worker keep running
    Then plan reads fall back to the open-source plan
    And single sign-on and other gated features stop answering as licensed

  @unit
  Scenario: An expired standard license keeps today's behaviour
    Given an install holding a standard license past its expiry
    When the plan is read
    Then the answer is the same as before testing licenses existed

  @unit
  Scenario: A testing license cannot be reset onto another instance or turned standard
    Given a testing license in the registry
    When an operator resets its instance binding, or reissues it
    Then the reset is refused
    And the reissued license is still a testing license for the same instance and organization

  # ============================================================================
  # Issuing
  # ============================================================================

  @unit
  Scenario: Cloud staff get a testing license with no browser step
    Given a caller signed in with a token from a person holding ops permissions on Cloud
    When they ask for a testing license for an instance and one of its organizations
    Then Cloud issues it, naming that person as the issuer
    And it lasts 5 days unless they asked for another length

  @unit
  Scenario: A testing license can be asked for a shorter or longer time, up to 30 days
    Given a signed-in caller holding ops permissions on Cloud
    When they ask for a testing license lasting 12 hours
    Then it lasts 12 hours
    When they ask for one lasting 45 days
    Then it is refused with a code naming the limit of 30 days

  @unit
  Scenario: Someone without ops permissions on Cloud gets no testing license
    Given a signed-in caller who holds no ops permissions on Cloud
    When they ask for a testing license
    Then it is refused before the handler runs
    And no license is written to the registry

  @unit
  Scenario: The signed-in token can only issue testing licenses
    Given a token haven received when its developer signed in
    When it is presented to any other ops or licensing operation
    Then it is refused, even though the person behind it may do that operation in the browser

  @unit
  Scenario: Losing ops permissions stops new testing licenses
    Given a person whose haven token issued testing licenses before
    When their ops permissions on Cloud are removed
    Then the next testing license asked for with that token is refused
    And the licenses already issued run only until their expiry

  @unit
  Scenario: An ops manager creates a service token for CI
    Given a person holding ops permissions on Cloud
    When they create a service token named "GitHub Actions" without choosing an expiry
    Then the token is shown once and expires in 90 days
    And choosing an expiry longer than a year is refused

  @unit
  Scenario: A revoked or expired service token issues nothing
    Given a service token that was revoked, and another past its expiry
    When either asks for a testing license
    Then it is refused and no license is written

  @unit
  Scenario: A service token stops when the person who made it loses ops permissions
    Given a service token made by someone who later lost their ops permissions on Cloud
    When the token asks for a testing license
    Then it is refused, because a service token acts as the person who made it

  @unit
  Scenario: Ops managers see every service token and when it was last used
    When an ops manager opens the service token list
    Then each token shows its name, kind, the person it belongs to, its expiry and when it last issued a license
    And any ops manager can revoke it

  @unit
  Scenario: A person with ops permissions mints a personal token through the browser sign-in
    Given a developer who holds ops permissions on Cloud and asked the CLI sign-in for a testing-license token
    When they approve the sign-in in the browser
    Then the CLI's next poll receives a personal testing-license token and its expiry
    And the sign-in code is spent and cannot be exchanged again

  @unit
  Scenario: The browser sign-in refuses a testing-license token to someone without ops permissions
    Given a person who holds no ops permissions on Cloud and a sign-in that asked for a testing-license token
    When they approve the sign-in in the browser
    Then the approval is refused with the code testing_license_requires_ops_manage
    And no token is minted and the code stays unapproved

  @unit
  Scenario: The browser sign-in page says what a testing-license sign-in allows
    Given a sign-in that asked for a testing-license token
    When the person opens the browser sign-in page and confirms the code
    Then the page says haven will issue developer testing licenses in their name while they hold ops permissions on Cloud
    And no project or key-permission choices are shown
    When they approve it
    Then the approval carries the organization they picked and no key selection
    And if the approval is refused the page says only people with ops permissions on Cloud can approve it

  @unit
  Scenario: The browser sign-in page names the device that asked
    Given a sign-in whose device code came with a device label such as "haven on alice-mbp"
    When the person opens the browser sign-in page
    Then the page names that device in place of "the device that showed this code"
    And the label is shown as plain text, shortened if it is long
    And a sign-in that came with no label keeps the generic wording

  # ============================================================================
  # Ops pages
  # ============================================================================

  @unit
  Scenario: Testing licenses are hidden from the license list until asked
    Given a standard license and a testing license in the registry
    When an operator opens the license list
    Then only the standard license is listed and counted
    When the operator asks to include testing licenses
    Then the testing license is listed with a Testing badge, its issuer, instance and expiry

  @unit
  Scenario: Testing licenses never count towards seats or invoices
    Given a customer with a standard license and a testing license
    When their seats and contract totals are computed
    Then the testing license adds nothing

  @unit
  Scenario: An organization admin reads the instance id a testing license binds to
    Given a signed-in admin of an organization on a stack
    When they ask for the stack's instance id
    Then the same id is answered every time
    And someone who may only view the organization is refused

  @unit
  Scenario: Signing haven out revokes its token on Cloud
    Given a signed-in haven
    When the developer signs haven out
    Then the token is revoked on Cloud and forgotten locally
    And a later ask with that token is refused

  @unit
  Scenario: Ops screens name the people behind tokens and licenses
    Given testing-license tokens made by people and licenses issued by people
    When an operator opens the token list or a license
    Then each token shows the name of the person who made it, and each license the name of its issuer
    And the short id stays beside the name, and shows alone when the person is gone

  # ============================================================================
  # haven
  # ============================================================================

  @unit
  Scenario: haven asks for a testing license only when told to
    When haven starts a stack without asking for a testing license
    Then it does not contact Cloud for a license

  @unit
  Scenario: Signing haven in once is enough
    Given a developer who signed haven in to their Cloud account
    When haven starts a stack asking for a testing license
    Then it gets the license from Cloud and stores it without opening a browser
    And the token is never printed

  @unit
  Scenario: haven renews a testing license before it expires
    Given a stack holding a testing license close to its expiry, and a signed-in haven
    When haven checks the stack
    Then it asks Cloud for a new testing license for the same instance and organization
    And the stack keeps its licensed features without a gap

  @unit
  Scenario: A haven that is not signed in still starts the stack
    Given a haven that was never signed in to Cloud
    When it starts a stack asking for a testing license
    Then the stack starts on the open-source plan
    And haven says to sign in first, naming the command

  @unit
  Scenario: CI gets a testing license through a service token
    Given a CI job holding a service token in its protected secrets
    When the job starts a stack asking for a testing license
    Then it gets the license without a person present
    And the registry names the person who made the token as the issuer
