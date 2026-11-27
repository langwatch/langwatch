Feature: A model is priced in one billing unit
  A catalogue entry may price tokens, characters or seconds of audio. A span can
  report more than one of those quantities at once, such as a transcription that
  carries both token usage and its duration. If the entry priced two units, the
  same request would be charged twice. Token rates win wherever they exist.

  Rule: Token rates win over per-character and per-second rates

    @unit
    Scenario: A litellm model with token rates keeps no per-second rate
      Given litellm prices a transcription model per token and per second
      When the litellm prices are mapped to catalogue entries
      Then the entry carries the token rates and no per-second rate

    @unit
    Scenario: A span with tokens and a duration is charged for its tokens only
      Given a rate that carries both token rates and a per-second rate
      When a span reporting tokens and audio seconds is priced
      Then the cost is the token cost, with nothing added for the seconds

  Rule: The catalogue audit refuses a model priced in two units

    @unit
    Scenario: The audit blocks on an entry priced in two units
      Given a catalogue entry priced per token and per second
      When the catalogue is audited
      Then the entry is a blocking finding that no baseline can accept

    @unit
    Scenario: The committed catalogue prices every model in one unit
      Given the merged model catalogue
      When every entry's priced units are counted
      Then no entry prices more than one unit
