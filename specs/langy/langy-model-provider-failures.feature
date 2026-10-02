Feature: A turn that the model provider refused says so

  Langy calls a model provider through the platform's proxy. When that call is
  refused, the proxy records WHICH way it was refused as a code from a fixed
  set: rate limited, unauthorized, unavailable, and the rest.

  The card the customer reads used to ignore that and say only "Langy hit an
  error while writing this reply. Your message is safe, try again." For a rate
  limit that sends the customer straight back into the limit, and for a bad
  credential it sends them nowhere at all.

  Copy varies on the code, never on the provider's own sentence. A provider
  writes its error body for whoever holds the key, which for a platform call is
  LangWatch, so that text can carry a platform credential and is never shown.

  Rule: The card names the failure the provider actually returned

    @unit
    Scenario: A rate-limited model reads as the provider being busy
      Given a turn that failed because the model provider is rate limiting
      When the customer reads the card
      Then it says the provider is rate limiting and to wait a minute, or to pick a model with more room
      And it offers to try again

    # The proxy files a provider-native failure body under its own code with
    # the provider's discriminant beneath it, and only falls back to the
    # status reason when the body names nothing. A tokens-per-minute limit
    # on a small Azure deployment answers a guided turn exactly that way.
    @unit
    Scenario: A rate limit filed under the provider's own code reads the same way
      Given a turn that failed with the proxy's upstream code carrying the provider's own rate limit code, and no status reason
      When the customer reads the card
      Then it is the provider card saying the provider is rate limiting
      And it offers to try again

    @unit
    Scenario: A provider outage reads as the provider being down
      Given a turn that failed because the model provider is unavailable
      When the customer reads the card
      Then it says the provider is temporarily unavailable
      And it offers another model as a way around it

    # A Bedrock key without access to the chosen model answers 403 with its
    # own "access_denied" code, so the proxy files that code under its own
    # upstream code and no status reason. The card said only "Langy's reply
    # failed", and the customer had no way to know the provider refused.
    @unit
    Scenario: A model the provider refuses to this key reads as a credential to check
      Given a turn that failed with the proxy's upstream code carrying the provider's own "access_denied" code
      When the customer reads the card
      Then it is the provider card saying the provider refused this key or its access to the model
      And it offers to open the model settings
      And it does not offer to try again

    @unit
    Scenario: A model the provider does not know reads as a model to check
      Given a turn that failed with the proxy's upstream code carrying the provider's own "model_not_found" code
      When the customer reads the card
      Then it is the provider card saying the provider does not serve that model
      And it offers to open the model settings

    @unit
    Scenario: Any failure filed under the proxy's upstream code reads as the provider's
      Given a turn that failed with the proxy's upstream code carrying a provider code the client does not classify
      When the customer reads the card
      Then it is the provider card, not "Langy's reply failed"
      And it offers to try again

  Rule: A model this project cannot serve says so, and offers the settings

    Being refused by a provider and having no provider at all are different
    problems with different next steps. A refusal can pass, so the card offers
    another try. An unreachable model cannot pass on its own, so the card
    offers the model settings instead.

    The gateway already writes for this case, but it writes for whoever
    configures a virtual key: bind the provider to the key, or drop the prefix
    from the model name. In the panel the model came from a menu, and there is
    no key and no prefix to edit, so the panel says it in its own words.

    @unit
    Scenario: A model with no provider connected reads as a model to change
      Given a turn that failed because no provider serves the chosen model
      When the customer reads the card
      Then it says the model has no provider connected in this project
      And it offers to open the model settings
      And it does not offer to try again

    @unit
    Scenario: A disabled provider reads the same way
      Given a turn that failed because the provider for the chosen model is off
      When the customer reads the card
      Then it says the model has no provider connected in this project

  Rule: A more specific failure keeps its own card

    An expired sign-in and a spent plan allowance are refusals too, but each
    has one exact remediation, so each keeps the card written for it.

    @unit
    Scenario: A dead codex session still wins over the upstream status
      Given a turn that failed with both an unauthorized status and a dead sign-in
      When the customer reads the card
      Then it is the sign-in card, not the general provider one
