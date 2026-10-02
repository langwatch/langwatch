Feature: Web Push delivery
  Notification owns Web Push as a destination kind (ADR-167): the devices a person
  subscribed, the installation's VAPID key pair, and the sending. Every deployment, cloud
  or self-hosted, signs with a pair generated on first use and stored encrypted in its
  database; there is nothing to configure. A producer asks for one push to a person
  with requestWebPushDelivery; notification sends it to each of that person's devices
  from the worker, through the outbox, so a closed tab, a sleeping laptop or a network
  blip does not lose it.

  Rule: A person's devices are stored per endpoint

    @integration
    Scenario: Subscribing stores the device
      Given a signed-in person
      When their browser subscribes with an endpoint and its keys
      Then a subscription row holds their user id, the endpoint, both keys and the user agent

    @integration
    Scenario: The same browser subscribing again updates its row
      Given a browser already subscribed for a person
      When it subscribes again with the same endpoint and new keys
      Then there is still one row for that endpoint, holding the new keys

    @integration
    Scenario: A browser that changes hands moves to the new person
      Given a browser subscribed for one person
      When another person signs in on it and subscribes with the same endpoint
      Then the endpoint belongs to the second person only

    @integration
    Scenario: One person keeps a subscription per device
      Given a person subscribed on two browsers
      When they unsubscribe one of them
      Then only that browser's row is removed

    @unit
    Scenario: An endpoint that is not https is refused
      Given a subscription whose endpoint is "http://fcm.googleapis.com/fcm/send/1"
      When it is parsed
      Then it is refused

    @unit
    Scenario: An endpoint off the browser push services is refused
      Given a subscription whose endpoint is "https://push.acme.test/send/1"
      When the person subscribes with it
      Then it is refused and nothing is stored

  Rule: Every device of the person gets the push, once

    @unit
    Scenario: A push request queues one send per device
      Given a person subscribed on two browsers
      When a producer requests a push to that person
      Then one send is queued for each browser

    @unit
    Scenario: The same request asked twice queues nothing new
      Given a push request already queued for a person
      When the producer asks again with the same idempotency key
      Then no second send is queued

    @unit
    Scenario: Two devices of the same person each get one push, even for a redelivered event
      Given a person subscribed on a laptop and a phone
      When the same push is requested twice and every queued send runs
      Then the laptop and the phone each receive exactly one push

    @unit
    Scenario: A person with no device queues nothing
      Given a person who never subscribed a browser
      When a producer requests a push to that person
      Then nothing is queued

  Rule: A send is encrypted, signed and classified by the push service's answer

    @unit
    Scenario: A send carries the payload encrypted, a day's TTL, high urgency and a topic
      Given a subscribed browser
      When a push is sent to it
      Then the push service receives an aes128gcm body that the browser's keys decrypt to the payload
      And the request carries a VAPID authorization, a TTL of 86400, urgency "high" and a topic header

    @unit
    Scenario: A newer push about the same subject replaces the older one
      Given two pushes with the same topic
      When both are sent
      Then both carry the same topic header, at most 32 URL-safe characters

    @unit
    Scenario: A delivered push records the device's last success
      Given a subscribed browser
      When the push service answers 201
      Then the subscription's last success time is set

    @unit
    Scenario: A device the push service no longer knows is deleted
      Given a subscribed browser
      When the push service answers 404 or 410
      Then the subscription row is deleted
      And the send is not retried

    @unit
    Scenario: A busy or failing push service is retried with backoff
      Given a subscribed browser
      When the push service answers 429 with a Retry-After of 120 seconds, or a 5xx
      Then the send is retried, waiting at least the Retry-After

    @unit
    Scenario: A push the service refuses for good is not retried
      Given a subscribed browser
      When the push service answers 400
      Then the send ends without a retry and the subscription is kept

    @unit
    Scenario: A push service that cannot be reached is retried
      Given a subscribed browser
      When the connection to the push service fails
      Then the send is retried

    @unit
    Scenario: A device deleted before its send is skipped
      Given a send queued for a browser
      When the browser's subscription is deleted before the send runs
      Then nothing is sent

  Rule: Every installation can push without configuration

    @unit
    Scenario: The first use generates the installation's VAPID key pair and stores it encrypted
      Given an installation with no VAPID key pair stored
      When a browser asks for the Web Push public key
      Then a P-256 key pair is generated and stored, the private key encrypted
      And the browser receives the stored public key

    @integration
    Scenario: Two processes generating at once end up with one pair
      Given an installation with no VAPID key pair stored
      When two processes store a newly generated pair at the same time
      Then one pair is stored and both processes answer with it

    @unit
    Scenario: A later process reads the stored pair instead of generating
      Given an installation whose VAPID key pair is stored
      When another process starts and a browser asks for the public key
      Then it receives the stored public key

  Rule: A person who leaves takes their devices with them

    @unit
    Scenario: A deactivated person's devices are removed
      Given a person subscribed on a browser
      When the person is deactivated
      Then their subscriptions are deleted

    @unit
    Scenario: An erased person's devices are removed
      Given a person subscribed on a browser
      When the person is erased
      Then their subscriptions are deleted
