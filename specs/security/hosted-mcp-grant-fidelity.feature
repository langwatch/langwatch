Feature: Hosted MCP sessions carry no more authority than the grant behind them
  As a LangWatch operator
  I want the hosted Model Context Protocol flow to demand, and keep demanding,
  the permission its bearer actually confers
  So that a viewer's client can do only what the viewer can and an offboarded
  person cannot keep one

  Background:
    Given the hosted MCP endpoint is mounted on the API process

  Rule: The approval step demands no more than the session it mints can use

    The authorization code becomes a session that acts as the approving person,
    capped at one project, and every call it makes is asked that person's own
    permission. Seeing the project is therefore enough to approve a client: a
    viewer's client can read what the viewer reads and change nothing.

    @unit @regression
    Scenario: A project viewer mints an MCP authorization code
      Given a signed-in person who may view a project but not update it
      When they approve an MCP client for that project
      Then an authorization code bound to that client and redirect URI is stored

    @unit @regression
    Scenario: The approval step names the view grain
      Given a signed-in person and a registered MCP client
      When they approve that client for a project
      Then the permission probed is the one that lets them see the project

    @unit
    Scenario: A person who cannot see the project mints no code
      Given a signed-in person who holds no permission on a project
      When they approve an MCP client for that project
      Then the approval is refused as access denied
      And no authorization code is stored

  Rule: A bearer stops working when the grant it was minted from is gone

    The bearer lives thirty days. The membership behind it is re-proved on a
    short interval, so removing somebody from a project, or dropping their
    role, ends their sessions in minutes rather than weeks.

    @integration @regression
    Scenario: A bearer whose approver lost the permission is refused
      Given an MCP bearer minted through the OAuth flow for a person
      And that person no longer holds the permission on the project
      When they call an MCP route with that bearer
      Then the call is refused with the code "mcp_grant_revoked"

    @integration
    Scenario: A bearer whose approver still holds the permission is served
      Given an MCP bearer minted through the OAuth flow for a person
      And that person still holds the permission on the project
      When they call an MCP route with that bearer
      Then the call is served
      And the grant is re-proved rather than assumed

    @integration
    Scenario: A direct project API key carries no grant to re-prove
      Given a caller presenting a project API key as the bearer
      When they call an MCP route
      Then the call is served without probing any person's grant

    @unit @regression
    Scenario: A process without authorization refuses to boot by name
      Given an API process that composed no authorization service
      When the hosted MCP module is installed
      Then boot refuses, naming the missing authorization dependency, and mounts no endpoint

  Rule: Every hosted MCP route verb declares an access policy

    The family answers off the raw listener rather than the Hono stack, so no
    secured-app builder records it. It declares its policies by hand instead,
    and registers them when it is composed, so an authorization audit reading
    the route registry sees this surface like every other one.

    @unit @regression
    Scenario: Every path the dispatcher claims carries a declared policy
      Given the hosted MCP route policy declarations
      Then every path the dispatcher answers on appears among them
      And every declared path is one the dispatcher answers on

    @unit
    Scenario: The transport routes declare the credential they accept
      Given the hosted MCP route policy declarations
      Then the transport routes are handler-managed against an API key
      And the OAuth handshake and health routes are declared public

    @unit @regression
    Scenario: Composing the endpoint puts its routes in the registry
      When the hosted MCP endpoint is composed
      Then the route registry answers for every verb the family serves
