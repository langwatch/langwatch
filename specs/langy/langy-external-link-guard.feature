Feature: Langy shows where a link goes before it leaves LangWatch
  As a LangWatch user reading an answer from Langy
  I want any link that takes me off LangWatch to show me its real destination first
  So that a link whose words say one thing and whose address goes somewhere else cannot walk me into a fake sign-in page

  # ---------------------------------------------------------------------------
  # Why this exists
  #
  # Langy renders model output, and everything the model writes can be shaped by
  # data it just read: a trace label, a tool result, the contents of a page it
  # fetched. So the TEXT of a link in the panel is not trustworthy the way the
  # rest of the product's copy is. "[the LangWatch docs](https://evil.example)"
  # is one line of attacker-supplied markdown, sitting inside a surface the user
  # already trusts.
  #
  # The dialog is therefore not an "are you sure?" — it is a DESTINATION READER.
  # It leads with the host the browser will actually contact, parsed out of the
  # address rather than read off the link's words, so userinfo tricks
  # (https://langwatch.ai@evil.example), lookalike hosts, and suffix confusion
  # (langwatch.ai.evil.com) all read as what they are.
  #
  # One interception point: the Langy panel root. Every link the panel renders —
  # answers, cards, error remediation, whatever is added next — passes through
  # it, so no component has to remember to opt in.
  #
  # Related: langy-capability-cards.feature (cards that carry links),
  # langy-egress-enforcement.feature (the same threat, on the worker's side).
  # ---------------------------------------------------------------------------

  Background:
    Given I am signed in to LangWatch on a project
    And I have opened the Langy panel

  Rule: LangWatch destinations are never interrupted

    @integration
    Scenario: A link into the app opens straight away
      Given Langy's answer links to a trace in my project
      When I click it
      Then the trace opens with no dialog in between
      And the Langy panel stays open

    @integration
    Scenario: A link to the LangWatch documentation opens straight away
      # The documentation site is LangWatch's own, so it sits inside the same
      # circle of trust as the app. Stopping the customer on the single most
      # common legitimate link in the panel would teach them to click the
      # dialog away without reading it, which is exactly how a warning stops
      # working the day it matters.
      Given Langy's answer links to the LangWatch documentation
      When I click it
      Then the documentation opens with no dialog in between

    @integration
    Scenario: A link that is not a web address is left alone
      Given Langy's answer contains an email address link
      When I click it
      Then nothing is interrupted and my mail app is offered as usual

  Rule: A link that leaves LangWatch shows me where it goes first

    @integration
    Scenario: Clicking an off-site link asks first
      Given Langy's answer links to "https://example.com/pricing"
      When I click it
      Then I am shown where the link goes before anything opens
      And the host "example.com" is the most prominent thing in the dialog
      And the full address is shown underneath it

    @integration
    Scenario: The dialog reads the address, never the link's words
      Given Langy's answer shows the words "https://langwatch.ai/docs" on a link whose address is "https://evil.example/login"
      When I click it
      Then the dialog names "evil.example" as the destination
      And the words on the link are not presented as the destination

    # The host and the address are separate elements, and the address has its
    # own scroll box, so no length of path can push the host anywhere. That is
    # a layout guarantee, and layout is not observable in the component tests:
    # proving it needs a real browser, which is not written yet.
    @integration @unimplemented
    Scenario: A long address cannot hide the host
      Given Langy's answer links to a host followed by a very long path
      When I click it
      Then the host stays in view no matter how long the rest of the address is

    @integration
    Scenario: Staying keeps me where I am
      Given the dialog is showing a destination
      When I choose to stay
      Then nothing opens
      And I am back in the conversation with the link still focused

    # Whatever gesture started it, the destination opens in a new tab, and it
    # is given no handle back on the page it came from and no record of the
    # address it came from.
    @integration
    Scenario: Continuing opens the destination
      Given the dialog is showing a destination
      When I choose to open it
      Then the destination opens in a new tab
      And it gets no handle back on the page it came from
      And my conversation is still here when I come back

    @integration
    Scenario: Escape closes the dialog without opening anything
      Given the dialog is showing a destination
      When I press Escape
      Then nothing opens
      And I am back in the conversation with the link still focused

  Rule: The destination is worked out from the address, never from what the link says

    @unit
    Scenario Outline: Reading the true destination
      When a link in the panel points at "<address>"
      Then it is treated as "<verdict>"

      Examples: LangWatch's own destinations
        | address                              | verdict |
        | /my-project/messages/abc             | inside  |
        | messages/abc                         | inside  |
        | https://app.langwatch.ai/my-project  | inside  |
        | https://docs.langwatch.ai/introduction | inside |
        | https://LANGWATCH.AI/pricing         | inside  |
        | #section                             | ignored |

      Examples: Destinations dressed up as LangWatch
        | address                                   | verdict |
        | https://langwatch.ai@evil.example/login   | outside |
        | https://langwatch.ai.evil.com/login       | outside |
        | https://notlangwatch.ai/login             | outside |
        | https://evil.com/?next=https://langwatch.ai | outside |
        | //evil.com/login                          | outside |

      Examples: Addresses that are not somewhere to go
        | address                     | verdict     |
        | javascript:alert(1)         | unsupported |
        | data:text/html,<h1>hi</h1>  | unsupported |
        | mailto:hello@example.com    | ignored     |
        | https://                    | unsupported |
        |                             | ignored     |

    @unit
    Scenario: A host that merely looks like langwatch.ai is outside
      # Letters from other alphabets can draw a host that reads as "langwatch.ai"
      # to a human. The browser resolves it to its real, different name.
      When a link in the panel points at a host spelled with lookalike letters
      Then it is treated as outside LangWatch
      And the dialog shows the host the browser will really contact

  Rule: How I click does not change the answer

    @integration
    Scenario Outline: Every way of opening a link is checked
      Given Langy's answer links to "https://example.com/pricing"
      When I open it by <gesture>
      Then I am shown where the link goes before anything opens

      Examples:
        | gesture                     |
        | clicking it                 |
        | holding cmd and clicking it |
        | middle-clicking it          |
        | focusing it and pressing Enter |

    @integration
    Scenario: A link marked to open in a new tab is checked too
      Given Langy's answer links to "https://example.com" and opens in a new tab
      When I click it
      Then I am shown where the link goes before anything opens

  Rule: Only links written by the model are checked

    # The guard exists because answers are model output: their links are shaped
    # by whatever data the agent read. The panel's own chrome (the codex
    # sign-in's "Open openai.com" button, and any hardcoded affordance like it)
    # is authored by LangWatch, and a warning there would make the product read
    # as distrusting its own buttons. Chrome links declare themselves with a
    # marker the markdown renderer can never emit, so an answer cannot claim it.

    @integration
    Scenario: A button of LangWatch's own that leaves the app opens straight away
      Given the panel shows a LangWatch-authored button that opens an off-site page
      When I click it
      Then the page opens with no dialog in between

    @integration
    Scenario: An answer linking to the same address is still checked
      Given Langy's answer links to the same off-site address
      When I click it
      Then I am shown where the link goes before anything opens

  Rule: The check cannot be switched off

    @integration
    Scenario: There is no way to stop being asked
      Given the dialog is showing a destination
      Then it offers only to stay or to open the destination
      And it never offers to skip the check next time
