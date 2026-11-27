Feature: One Enterprise lock leads a self-hosted admin to the License page

  Audit log, Roles & access, single sign-on, the directory, data retention and
  the search-bar Instant Evals popup are Enterprise features. On a self-hosted
  install they are unlocked by activating a license, so every lock says so and
  leads to Settings > License, never to the Cloud plans page. A reader who may
  not activate a license is told who can, with no button that leads to a page
  they may not open. On Cloud the lock keeps offering the plans.

  Rule: a self-hosted lock names the license and leads to the License page

    @integration
    Scenario: An organization admin on a self-hosted install is offered to activate or get a license
      Given a self-hosted install with no Enterprise license
      And I am an organization admin
      When I open a page locked to Enterprise
      Then the lock says the feature is part of LangWatch Enterprise
      And it says in one line what the feature does
      And it offers "Activate a license" and "Get a license", both leading to Settings > License
      And it does not offer the Cloud plans

    @integration
    Scenario: A member on a self-hosted install is told to ask an admin
      Given a self-hosted install with no Enterprise license
      And I am a member who may not manage the organization
      When I open a page locked to Enterprise
      Then the lock says "Ask an organization admin to activate a license."
      And it offers no button

    @integration
    Scenario: A member whose role cannot open the audit log still sees the lock on a self-hosted install
      Given a self-hosted install with no Enterprise license
      And I am a member without permission to view the audit log
      When I open the audit log
      Then I see the audit log lock with "Ask an organization admin to activate a license."
      And I do not see a missing permission page

    @integration
    Scenario: A member without permission to view the audit log on a licensed install is told what is missing
      Given a self-hosted install with an Enterprise license
      And I am a member without permission to view the audit log
      When I open the audit log
      Then I see that my role is missing the permission to view the audit log

  Rule: on Cloud the lock keeps offering the plans

    @integration
    Scenario: An organization admin on Cloud is offered the plans
      Given an organization on LangWatch Cloud without Enterprise
      And I am an organization admin
      When I open a page locked to Enterprise
      Then the lock says the feature is included in Enterprise
      And it offers "See plans", leading to the plans page

    @integration
    Scenario: A member on Cloud who may not open the plans page is told to ask an admin
      Given an organization on LangWatch Cloud without Enterprise
      And I am a member who may not view the organization
      When I open a page locked to Enterprise
      Then the lock tells me to ask an organization admin about upgrading
      And it offers no link to the plans page

  Rule: every Enterprise page uses the same lock

    @integration
    Scenario: Each Enterprise page names its feature in the shared lock
      Given a self-hosted install with no Enterprise license
      And I am an organization admin
      When I open the audit log, Roles & access, Groups, single sign-on, the directory or data retention
      Then each lock says "<feature> is part of LangWatch Enterprise" with its own feature name
      And each offers "Activate a license" and "Get a license"

  Rule: the seat limit on a self-hosted install speaks of the license

    @integration
    Scenario: A self-hosted install that used every licensed seat is told so in license words
      Given a self-hosted install whose license seats are all in use
      When an admin invites one more member
      Then the dialog says every seat on the license is in use
      And it offers "Manage license", leading to Settings > License
      And it does not speak of a plan

    @integration
    Scenario: The seat banner on a self-hosted install offers the license, not the plans
      Given a self-hosted install that uses more seats than its license holds
      When any page opens
      Then the seat banner says the organization has more members than the license includes
      And it offers "Manage license"
      And it does not speak of a plan or offer "Compare plans"

  Rule: a platform page names the access it needs

    @integration
    Scenario: An organization admin without platform operator access opens an operator page
      Given I am an organization admin without platform operator access
      When I open the ops dashboard
      Then the page says it needs platform operator access
      And it does not tell me to ask an organization admin
