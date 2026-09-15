Feature: The service-does-not-open-a-channel lint rule
  A collaborator the module does not own is a channel, not a service member.
  A service that opens the event bus, Redis pub/sub, a vendor over HTTP, a
  queue, email or Slack has no seam a test can stand in for, and no name for
  the message it is really sending. See specs/architecture/channel-layer.feature
  for the layer itself.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A service may not open the event bus
    Given a file under services/ that imports @langwatch/eventing
    When the service-does-not-open-a-channel rule runs over it
    Then it reports serviceOpensAChannel naming the conduit
    And the message asks for the channel interface instead

  @unit
  Scenario: A service may not reach a vendor over HTTP
    Given a file under services/ that imports undici or calls fetch
    When the service-does-not-open-a-channel rule runs over it
    Then it reports serviceOpensAChannel

  @unit
  Scenario: A service may not publish on Redis pub/sub
    Given a file under services/ that imports ioredis
    When the service-does-not-open-a-channel rule runs over it
    Then it reports serviceOpensAChannel

  @unit
  Scenario: A service may not send email or post to Slack
    Given a file under services/ that imports resend, @slack/web-api or an AWS client
    When the service-does-not-open-a-channel rule runs over it
    Then it reports serviceOpensAChannel

  @unit
  Scenario: A service over a channel interface is allowed
    Given a file under services/ that imports only its module's channel interface
    When the service-does-not-open-a-channel rule runs over it
    Then it reports nothing

  @unit
  Scenario: A channel may open the conduit it wraps
    Given a file under channels/ that imports @langwatch/eventing
    When the service-does-not-open-a-channel rule runs over it
    Then it reports nothing
