Feature: Services authenticate with short-lived tokens and name whose behalf they act on

  Our services call each other: the app calls the NLP engine, langevals, the
  Langy agent and the AI gateway's internal surface, and those services call
  the app back. Each call proves which service sent it with a token that
  expires in minutes, and a call made for someone names that someone: a user,
  an API key (by its id, never its value), or a named system actor. Receivers
  write the chain into their logs, so an audit line reads "the engine, called
  by the app, acting for this user in this project".

  The app is the only issuer. It signs every token with a rotating key and
  publishes the public keys on an internal endpoint. A service that calls the
  app first proves who it is, with a Kubernetes service-account token or, where
  there is no cluster, a bootstrap secret of its own, and exchanges that proof
  for a token.

  Each hop moves from its shared secret to tokens through one switch with three
  positions: secret, dual, token. See ADR-186.

  # Tagging. Every scenario carries its intended binding level and
  # @unimplemented, because ADR-186 is a proposal and no code exists yet. The
  # tag comes off a scenario in the change that builds it, together with the
  # @scenario annotation on the test that binds it.

  Background:
    Given the app signs service tokens with a published, current key

  Rule: Every call from the app carries a delegation token for the receiving service

    @integration @unimplemented
    Scenario: A workflow run started by a user carries that user to the engine
      Given a user starts a workflow run in a project
      When the app calls the NLP engine for that run
      Then the call carries a delegation token addressed to the engine
      And the token names the user as the principal and the app as the actor
      And the token names the project and the permissions the run holds
      And the token carries no API key value

    @integration @unimplemented
    Scenario: A run started with an API key names the key, not its value
      Given an API key starts an evaluation through the REST API
      When the app calls langevals for that evaluation
      Then the delegation token names the API key by its id

    @integration @unimplemented
    Scenario: A run nobody started names the system actor
      Given a monitor starts an online evaluation on its own schedule
      When the app calls the engine for it
      Then the delegation token names the unattended-run system actor as the principal

    @unit @unimplemented
    Scenario: A delegation token is short-lived
      When the app mints a delegation token
      Then it expires two minutes after it was issued

  Rule: A receiver binds the request to the token

    @integration @unimplemented
    Scenario: The engine refuses a body that names another project
      Given a delegation token for project A
      When a request with that token asks the engine to run a workflow for project B
      Then the engine refuses it as a project mismatch
      And runs nothing

    @integration @unimplemented
    Scenario: A receiver refuses an action outside the token's permissions
      Given a delegation token whose permissions do not include running code
      When the request asks the engine to run a code block
      Then the engine refuses it as outside the delegated permissions

    @unit @unimplemented
    Scenario: A chain deeper than four services is refused
      Given a delegation token whose actor chain names five services
      When a receiver verifies it
      Then the receiver refuses it as a chain too deep

  Rule: A service that calls the app proves who it is first

    @integration @unimplemented
    Scenario: A service in a cluster exchanges its service-account token
      Given the Langy agent runs with a service-account token addressed to the app
      When it asks the app for a token to report a turn result
      Then the app returns a service token naming the Langy agent
      And the token expires two minutes after it was issued

    @integration @unimplemented
    Scenario: A service without a cluster exchanges its own bootstrap secret
      Given the gateway runs under docker compose with its own bootstrap secret
      When it asks the app for a token
      Then the app returns a service token naming the gateway

    @integration @unimplemented
    Scenario: One service's bootstrap secret does not buy another service's token
      Given the gateway's bootstrap secret
      When it is presented to ask for a token naming the Langy agent
      Then the app refuses the exchange

    @integration @unimplemented
    Scenario: A service acting for a person proves the token was handed to it
      Given the engine holds a delegation token whose innermost actor is the engine
      And it holds a service token naming the engine
      When it calls the app back with both
      Then the app accepts the call as the engine acting for that person

    @integration @unimplemented
    Scenario: A stolen delegation token is useless to another service
      Given a delegation token whose innermost actor is the engine
      When the gateway presents it with the gateway's own service token
      Then the app refuses the call

  Rule: Long work renews its token without widening it

    @integration @unimplemented
    Scenario: A long run renews its delegation token
      Given a workflow run whose bound is forty minutes
      And its delegation token is about to expire
      When the engine exchanges it together with its own service token
      Then it receives a fresh token with the same principal and permissions

    @integration @unimplemented
    Scenario: A renewal cannot outlive the run
      Given a delegation token whose run bound has passed
      When the engine asks to renew it
      Then the app refuses the renewal

  Rule: Expected failures are named; the rest degrade to unknown

    @unit @unimplemented
    Scenario: An expired token is refused as expired
      Given a token that expired a minute ago
      When a receiver verifies it
      Then the receiver refuses it with service_token_expired

    @unit @unimplemented
    Scenario: A small clock difference is tolerated
      Given a token that expired twenty seconds ago by the receiver's clock
      When a receiver verifies it
      Then the receiver accepts it

    @unit @unimplemented
    Scenario: A token for another service is refused
      Given a token addressed to langevals
      When the engine verifies it
      Then the engine refuses it with service_token_wrong_audience

    @integration @unimplemented
    Scenario: An unknown key is looked up once before the token is refused
      Given a token signed with a key the receiver has not cached
      When the receiver verifies it
      Then it fetches the published keys once
      And refuses the token with service_token_unknown_key if the key is still absent

    @integration @unimplemented
    Scenario: A receiver keeps verifying while the app is unreachable
      Given a receiver that fetched the published keys earlier
      And the app is unreachable
      When the receiver verifies a token signed with a cached key
      Then it accepts the token

    @integration @unimplemented
    Scenario: A cold receiver with no keys and no app reports an unknown failure
      Given a receiver that has never fetched the published keys
      And the app is unreachable
      When the receiver verifies a token
      Then it refuses the call as an unknown error with a trace id

  Rule: Keys rotate without an outage

    @integration @unimplemented
    Scenario: A new key is published before it signs
      When the app creates a new signing key
      Then the key appears on the published keys a day before any token uses it

    @integration @unimplemented
    Scenario: A retired key stays published until its last token expires
      When the app stops signing with a key
      Then the key stays published until every token it signed has expired

  Rule: Each hop moves from its secret to tokens through one switch

    @integration @unimplemented
    Scenario: In secret mode the receiver records a valid token but needs only the secret
      Given the engine hop is in secret mode
      When a call presents the shared secret and a valid token
      Then the engine accepts it
      And records that the call presented a token

    @integration @unimplemented
    Scenario: In dual mode either credential is enough
      Given the engine hop is in dual mode
      When a call presents only the shared secret
      Then the engine accepts it
      And records that the call used the secret

    @integration @unimplemented
    Scenario: In dual mode an invalid token is refused even with the secret
      Given the engine hop is in dual mode
      When a call presents the shared secret and an expired token
      Then the engine refuses it with service_token_expired

    @integration @unimplemented
    Scenario: In token mode the secret alone is refused
      Given the engine hop is in token mode
      When a call presents only the shared secret
      Then the engine refuses it with service_token_required

  Rule: Every accepted call is attributable

    @integration @unimplemented
    Scenario: The receiver logs the principal and the service chain
      Given a user starts a workflow run
      When the engine accepts the app's call
      Then the engine's log line and span name the user, the app as the actor, and the token id
