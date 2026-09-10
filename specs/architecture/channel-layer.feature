Feature: The channel layer
  A module has four kinds of collaborator. A repository is state the module
  owns (Postgres, ClickHouse, Redis as a store). A channel is messages to or
  from something the module does not own, in either direction, with no owned
  state: the event bus, Redis pub/sub, HTTP to a vendor, a queue, email,
  Slack, a browser over SSE. A service is behaviour over repositories and
  channels. A pool member is the raw technical client the process supplies,
  which a channel wraps with the module's own message types.

  The shape mirrors repositories: an interface at
  channels/<subject>.channel.ts, implementations at
  channels/<tier>/<tier>.<subject>.channel.ts, a memory twin, and
  defineChannels({ live, memory }) in the module's registry.

  The rule that keeps a service out of a channel is specified in
  specs/tooling/lint-service-does-not-open-a-channel.feature.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A channel interface lives at channels/<subject>.channel.ts
    Given a channel interface at channels/webhook.channel.ts in a server module
    When the feature-source-layout rule runs over it
    Then it reports nothing

  @unit
  Scenario: A channel implementation is named for its tier folder
    Given a channel implementation at channels/http/http.webhook.channel.ts
    When the feature-source-layout rule runs over it
    Then it reports nothing

  @unit
  Scenario: A channel implementation in the wrong tier folder is refused
    Given a channel implementation at channels/http/redis.webhook.channel.ts
    When the feature-source-layout rule runs over it
    Then it reports the file as outside the server grammar

  @unit
  Scenario: A channels folder without a registry is conversion debt
    Given a feature whose channels folder has no <feature>-channels.registry.ts
    When the feature shape is collected
    Then it reports unregistered-channels naming the channels folder

  @unit
  Scenario: A live channel without a memory twin is conversion debt
    Given a feature with a live channel tier and no channels/memory folder
    When the feature shape is collected
    Then it reports unregistered-channels naming the live tier folder
