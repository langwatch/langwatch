Feature: Composing outbound mail delivery

  Three of the pipelines still waiting to leave the application mapper end in
  an email — the join request's day-7 reminder and its lapse notice, the
  automation settlement digest, the evaluation graph trigger. None of them can
  move while the only outbound mail gateway in the repository is a module of
  the application, so this capability is the wall those three share.

  What a process needs to send mail is a resolved configuration and a
  transport. Nothing here reads an environment: a composition root projects one
  `MailerConfiguration` at boot and hands it down, which is what keeps
  credentials stable for the lifetime of a process and lets a test compose a
  delivery graph with no environment at all.

  A deployment with no email provider configured is an ordinary self-hosted
  install, not an error. Such a graph still composes, still mounts every
  pipeline, and fails at the moment of a send — which the notification fan-outs
  survive, because the durable fact is the request and never the courtesy.

  @unit
  Scenario: The gateway named by the deployment is the one that sends
    Given a mailer configuration naming one provider
    When the delivery capability sends a message
    Then it sends through the named gateway
    And a second send reuses the same transport

  @unit
  Scenario: A named but unusable gateway refuses instead of falling back
    Given a mailer configuration naming a provider whose credentials are absent
    When the delivery capability sends a message
    Then the send is refused naming the setting the operator must supply
    And no other configured gateway is used in its place

  @unit
  Scenario: A deployment with no provider composes and fails only at send time
    Given a mailer configuration with no provider settings at all
    When the delivery capability is composed
    Then composition succeeds
    And a send fails without naming any internal detail

  @unit
  Scenario: Blind recipients never reach the rendered headers
    Given a message carrying blind recipients
    When each gateway prepares it for its transport
    Then the rendered To list carries only the public recipients
    And the blind addresses travel in the envelope

  @unit
  Scenario: A crafted header cannot inject another one
    Given a message carrying a header name and value with line breaks
    When the message is prepared for the wire
    Then the line breaks are removed from both the name and the value

  @unit
  Scenario: The sender address a deployment did not name is derived once
    Given a deployment that set no explicit sender address
    When the mail configuration is resolved
    Then the sender is derived from the deployment's own host
    And it matches the address the application derives from the same host

  @unit
  Scenario: Closing the capability releases the transport once
    Given a delivery capability that has sent a message
    When it is closed twice
    Then the gateway is closed exactly once
    And a later send is refused
