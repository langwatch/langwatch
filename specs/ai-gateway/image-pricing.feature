Feature: Image calls are priced from the image token buckets they report
  As an operator paying for image traffic through the gateway
  I want image tokens priced at the image rates, apart from text tokens
  So that the trace span cost and the budget debit both state the real charge

  # An image model bills three buckets at three different rates: text in,
  # image in and image out. A text-only rate applied to image tokens is off by
  # a factor of six on gpt-image-2, so the cost chain keeps the buckets apart
  # from the catalog entry down to the span attribute and the spend payload.

  Background:
    Given the catalog carries the gpt-image models with text in, image in and image out rates

  Rule: A span states the cost of every bucket it reports

    @unit
    Scenario: an image generation is priced by the image tokens it produced
      Given a generation span with a text prompt and output image tokens
      When the span is costed
      Then the text prompt is priced at the text rate
      And the output image tokens are priced at the image out rate

    @unit
    Scenario: an image edit is priced for the pixels it read and the pixels it wrote
      Given an edit span with text in, input image tokens and output image tokens
      When the span is costed
      Then all three buckets are priced at their own rates

    @unit
    Scenario: an image call with no text usage still gets a cost
      Given a span that carries output image tokens and no text tokens
      When the span is costed
      Then the catalog is consulted for the image tokens alone
      And the cost is above zero

    @unit
    Scenario: the image count alone prices nothing
      Given a span that carries an image count and no tokens
      When the span is costed
      Then the cost is zero, because the count is a display quantity

  Rule: The cost arithmetic prices image buckets without a text fallback

    A text rate applied to image tokens reads as a plausible number, which is
    what makes the fallback dangerous. An image bucket with no image rate is
    priced at zero instead.

    @unit
    Scenario: a generation prices text in plus image out
      Given a catalog entry with a text in rate and an image out rate
      When a generation with text in and output image tokens is priced
      Then the total is the two buckets at their own rates

    @unit
    Scenario: an edit prices text in, image in and image out
      Given a catalog entry that carries all three rates
      When an edit reporting all three buckets is priced
      Then the total is the three buckets at their own rates

    @unit
    Scenario: a rule that prices only image tokens is a priced rule
      Given a catalog entry whose only rate is an image out rate
      When a call reporting output image tokens is priced
      Then the entry counts as priced and returns that charge

    @unit
    Scenario: a model with no rate at all still reports "cannot price"
      Given a catalog entry with no rate of any kind
      When a call reporting output image tokens is priced
      Then the result is "cannot price" rather than zero

    @unit
    Scenario: a chat model never bills pixels it cannot produce
      Given a chat model entry with text rates and no image rate
      When a call carrying output image tokens is priced
      Then only the text tokens are charged
      And the image tokens are priced at zero, not at the text rate

  Rule: A custom cost rule prices its own text and leaves the pixels to the catalog

    A custom rule holds text and cache rates only, so an image call under one
    would price its image tokens at nothing, and a generation is almost all
    image tokens. The catalog fills the two image buckets the rule cannot
    state.

    @unit
    Scenario: a custom text rate does not zero the image tokens
      Given a project rule that sets a text rate for an image model
      When a generation or an edit on that model is costed
      Then the text is priced at the rule's rate
      And the image tokens are priced at the catalog's image rates

    @unit
    Scenario: an override that prices nothing keeps the images free
      Given a rule whose every rate is zero, which states the model is free
      When an image call on that model is costed
      Then the charge is zero, because no catalog rate fills a free model

    @unit
    Scenario: the spend wire prices images from the catalog alone
      Given a project that set a custom rule for an image model
      When the spend wire rates a request on that model
      Then both image buckets price at the catalog rates
      # The spend wire reads no custom rule, so it never had the gap the
      # trace wire had.

  Rule: The trace and the ledger state one figure

    @unit
    Scenario: the trace span cost and the budget debit agree on an image call
      Given one image edit reported on the span and on the spend payload
      When the span cost and the spend rate are both computed
      Then both surfaces state the same charge
