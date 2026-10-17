Feature: Langy helps a person connect the LangWatch MCP server to their AI client
  As someone who wants LangWatch inside Claude, Cursor, ChatGPT or their IDE
  I want Langy to show me how to connect the LangWatch MCP server
  So that I can set it up in my client without reading the docs first

  # The connect-mcp skill (skills/connect-mcp/SKILL.mdx, Langy only) has Langy
  # call the worker's `mcp_setup` tool, and the panel draws the call as the MCP
  # setup card (an `ask` card). The card reads this deployment's public base
  # URL in the browser, so the MCP address is never typed by the model and
  # never taken from the worker's environment, whose LangWatch address may be
  # one only the sandbox reaches. The address is `<base URL>/mcp` over
  # Streamable HTTP; the old `/sse` address is retired and never recommended.

  Background:
    Given I am signed in with Langy enabled for a project

  Rule: The skill shows the card and leaves the address to it

    @unit
    Scenario: The connect-mcp skill ships with Langy only
      Then Langy's skills include connect-mcp
      And the public skills repository does not
      And its compiled copy matches its source

    @unit
    Scenario: The skill's description names the clients and the asks it answers
      Then its description names MCP, Claude, Claude Code, ChatGPT, Cursor and VS Code
      And it says to use it when someone asks to set up the LangWatch MCP or their connection fails

    @unit
    Scenario: The skill shows the card and never types the address
      When I ask Langy to set up the LangWatch MCP
      Then the skill has Langy call mcp_setup once, recommending OAuth
      And it tells Langy never to type the MCP address or take one from its shell environment

    @unit
    Scenario: The skill never recommends the retired /sse address
      Then the skill gives the address as the base URL and /mcp
      And it names /sse only as retired

    @unit
    Scenario: The skill covers the connection failures
      Then it says a 401 means signing in again or replacing the key
      And a 404 on a session means the client reconnects on its own
      And AUTH_REQUIRED on a write tool means connecting with OAuth instead

  Rule: The worker's mcp_setup tool puts the card up

    @unit
    Scenario: The worker tool puts up the card and tells the model not to repeat it
      When Langy calls mcp_setup
      Then the tool answers that the card is shown
      And it tells the model not to repeat the address, the steps or a command

    @unit
    Scenario: An unknown client or method is refused with the options
      When Langy calls mcp_setup with a client or a method the card does not know
      Then nothing is shown
      And the refusal lists the clients or the methods it knows

  Rule: The MCP setup card walks the person through their client

    @integration
    Scenario: The MCP setup call is a card, not an activity row
      When an assistant message carries an mcp_setup call
      Then the transcript draws the MCP setup card where the call ran
      And the activity spine leaves the call out

    @integration
    Scenario: The card shows this deployment's own MCP address
      Given this LangWatch is served at https://langwatch.acme.example
      When the MCP setup card renders
      Then it shows https://langwatch.acme.example/mcp with a copy button
      And a "Full guide" link to https://langwatch.ai/docs/integration/mcp

    @integration
    Scenario: OAuth is preselected and marked recommended
      When the MCP setup card renders
      Then OAuth is selected with a "Recommended" badge
      And one line says there is no key to manage, access is tied to me and the project I approve, and it refreshes itself

    @integration
    Scenario: Claude Code gets a copyable command
      Given Langy called mcp_setup for Claude Code
      When the MCP setup card renders
      Then Claude Code is the picked client
      And the steps show "claude mcp add --transport http langwatch <address>" with a copy button

    @integration
    Scenario: The API key method links to the API keys page and shows the header
      When I pick Cursor and then "API key" on the card
      Then the card shows the header "Authorization: Bearer YOUR_API_KEY"
      And a link to Settings, API Keys
      And the Cursor steps for a key
