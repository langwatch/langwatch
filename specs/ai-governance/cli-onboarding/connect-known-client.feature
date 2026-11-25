Feature: A known app connects a project through the device flow and is named on the approval page
  As a person connecting Laze to LangWatch
  I want the approval page to name Laze and say what Laze gets
  So that I approve a project for the app I am using, not for a CLI I never ran

  # Laze runs the same device flow `langwatch login --project` uses: it asks
  # for a project_api_key device code with `client: "laze"`, the person
  # approves on /cli/auth, and Laze's server polls /exchange for a project
  # session. The client is a fixed list of known apps, never free text, so
  # nobody can make the page name an app of their choosing.

  @bdd @cli-onboarding @known-client @integration
  Scenario: the approval page names Laze and says what Laze gets
    Given a signed-in user on /cli/auth with a pending project_api_key device code
    And the device code was requested with client "laze"
    When the page renders
    Then the title reads "Connect Laze to LangWatch"
    And the subtitle reads "Laze will send its agents' traces to the project you pick."
    And the code step reads "Confirm this matches the code shown in Laze."
    And no copy on the page mentions the CLI, a terminal or .env

  @bdd @cli-onboarding @known-client @integration
  Scenario: approving connects the picked project and tells the person to go back to Laze
    Given a signed-in user on /cli/auth with a pending project_api_key device code
    And the device code was requested with client "laze"
    When the user confirms the code, picks a project and clicks "Connect project"
    Then the approval sends the picked project
    And the success card reads "Laze is connected" and names the project and organization

  @bdd @cli-onboarding @known-client @integration
  Scenario: denying tells the person Laze was not connected
    Given a signed-in user on /cli/auth with a pending project_api_key device code
    And the device code was requested with client "laze"
    When the user denies the request
    Then the page reads "Laze was not connected. You can close this tab."

  @bdd @cli-onboarding @known-client @integration
  Scenario: an organization with no projects asks for one without the CLI wording
    Given a signed-in user on /cli/auth with a pending project_api_key device code
    And the device code was requested with client "laze"
    And the user's organization has no projects
    When the user confirms the code
    Then the page reads "Create a project in this organization first, then pick it here."
    And no copy on the page mentions the CLI, a terminal or .env

  @bdd @cli-onboarding @known-client @integration
  Scenario: an expired Laze code sends the person back to Laze
    Given a project_api_key device code requested with client "laze" that has expired
    When the approval page looks the code up
    Then the lookup answers 410 expired with client "laze"
    And the page reads "This code expired. Go back to Laze and press Connect with LangWatch again."
    And the page never tells the person to run langwatch login

  @bdd @cli-onboarding @known-client @integration
  Scenario: the lookup answers the client the device code was requested with
    Given a project_api_key device code requested with client "laze"
    When the approval page looks the code up
    Then the lookup answers client "laze"
    And the exchange after approval answers a project session with the project and organization

  @bdd @cli-onboarding @known-client @integration
  Scenario: an unknown client value is refused
    When a device code is requested with credential_type "project_api_key" and client "acme"
    Then the request is refused with 400 invalid_request

  @bdd @cli-onboarding @known-client @integration
  Scenario: a client on a device session login is refused
    When a device code is requested with credential_type "device_session" and client "laze"
    Then the request is refused with 400 invalid_request

  @bdd @cli-onboarding @known-client @integration
  Scenario: a device code stored before the client field reads as no client
    Given a pending device code stored without a client field
    When the approval page looks the code up
    Then the lookup answers client null
