import { describe, expect, it } from "vitest";
import type { Span } from "../../../server/tracer/types";

// Import the function we want to test
import { generateMermaidSyntax, INVISIBLE_RETURN } from "../SequenceDiagram";

describe("generateMermaidSyntax", () => {
  it("should generate correct Mermaid sequence diagram syntax from spans", () => {
    // Create a sample trace with various span types
    const mockSpans: Span[] = [
      // Root agent span
      {
        span_id: "span-1",
        parent_id: null,
        trace_id: "trace-123",
        type: "agent",
        name: "CustomerSupportAgent",
        input: {
          type: "text",
          value: "How can I help you today?",
        },
        output: {
          type: "text",
          value: "I'll help you with your account inquiry.",
        },
        timestamps: {
          started_at: 1000,
          finished_at: 5000,
        },
        metrics: {
          cost: 0.001,
        },
      },
      // LLM span called by the agent
      {
        span_id: "span-2",
        parent_id: "span-1",
        trace_id: "trace-123",
        type: "llm",
        name: "OpenAI GPT-4",
        vendor: "openai",
        model: "gpt-4",
        input: {
          type: "chat_messages",
          value: [
            {
              role: "user",
              content: "Analyze the customer's request",
            },
          ],
        },
        output: {
          type: "text",
          value: "I need to check the customer's account status.",
        },
        timestamps: {
          started_at: 1500,
          finished_at: 3000,
        },
        metrics: {
          prompt_tokens: 50,
          completion_tokens: 25,
          cost: 0.002,
        },
      },
      // Tool span called by the LLM
      {
        span_id: "span-3",
        parent_id: "span-2",
        trace_id: "trace-123",
        type: "tool",
        name: "get_customer_account",
        input: {
          type: "json",
          value: { customer_id: "12345" },
        },
        output: {
          type: "json",
          value: { status: "active", balance: 1000 },
        },
        timestamps: {
          started_at: 2000,
          finished_at: 2500,
        },
      },
      // Another agent span (different agent)
      {
        span_id: "span-4",
        parent_id: "span-1",
        trace_id: "trace-123",
        type: "agent",
        name: "EscalationAgent",
        input: {
          type: "text",
          value: "Handle escalation if needed",
        },
        output: {
          type: "text",
          value: "No escalation needed",
        },
        timestamps: {
          started_at: 3500,
          finished_at: 4500,
        },
      },
      // LLM span with error
      {
        span_id: "span-5",
        parent_id: "span-4",
        trace_id: "trace-123",
        type: "llm",
        name: "Claude",
        vendor: "anthropic",
        model: "claude-3-opus",
        input: {
          type: "text",
          value: "Process escalation",
        },
        error: {
          has_error: true,
          message: "Rate limit exceeded",
          stacktrace: ["Error at line 1", "Error at line 2"],
        },
        timestamps: {
          started_at: 4000,
          finished_at: 4200,
        },
      },
      // Non-agent/LLM span (should be ignored for participants but used for context)
      {
        span_id: "span-6",
        parent_id: "span-1",
        trace_id: "trace-123",
        type: "chain",
        name: "ProcessingChain",
        input: {
          type: "text",
          value: "Chain processing",
        },
        output: {
          type: "text",
          value: "Chain complete",
        },
        timestamps: {
          started_at: 1200,
          finished_at: 1800,
        },
      },
    ];

    const result = generateMermaidSyntax(mockSpans);

    // Expected Mermaid syntax with manual activate/deactivate and invisible returns (tools are not participants)
    const expectedSyntax = `sequenceDiagram
    actor CustomerSupportAgent as CustomerSupportAgent
    participant ProcessingChain as ProcessingChain
    participant gpt_4 as gpt-4
    actor EscalationAgent as EscalationAgent
    participant claude_3_opus as claude-3-opus
    CustomerSupportAgent->>ProcessingChain: ProcessingChain
    activate ProcessingChain
    ProcessingChain-->>CustomerSupportAgent: ${INVISIBLE_RETURN}
    deactivate ProcessingChain
    CustomerSupportAgent->>gpt_4: LLM call
    activate gpt_4
    gpt_4->>gpt_4: tool: get_customer_account
    gpt_4-->>CustomerSupportAgent: ${INVISIBLE_RETURN}
    deactivate gpt_4
    CustomerSupportAgent->>EscalationAgent: handover
    activate EscalationAgent
    EscalationAgent->>claude_3_opus: LLM call (error)
    activate claude_3_opus
    claude_3_opus-->>EscalationAgent: ${INVISIBLE_RETURN}
    deactivate claude_3_opus
    EscalationAgent-->>CustomerSupportAgent: ${INVISIBLE_RETURN}
    deactivate EscalationAgent
`;

    expect(result).toBe(expectedSyntax);
  });

  it("should handle empty spans array", () => {
    const result = generateMermaidSyntax([]);
    expect(result).toBe("sequenceDiagram\n");
  });

  it("should handle spans with no agent or LLM interactions", () => {
    const mockSpans: Span[] = [
      {
        span_id: "span-1",
        parent_id: null,
        trace_id: "trace-123",
        type: "chain",
        name: "ProcessingChain",
        timestamps: {
          started_at: 1000,
          finished_at: 2000,
        },
      },
      {
        span_id: "span-2",
        parent_id: "span-1",
        trace_id: "trace-123",
        type: "tool",
        name: "some_tool",
        timestamps: {
          started_at: 1200,
          finished_at: 1800,
        },
      },
    ];

    const result = generateMermaidSyntax(mockSpans);

    // Now that tools cannot be participants, only chain spans will be included
    const expectedSyntax = `sequenceDiagram
    participant ProcessingChain as ProcessingChain
    ProcessingChain->>ProcessingChain: tool: some_tool
`;

    expect(result).toBe(expectedSyntax);
  });

  it("should sanitize participant names correctly", () => {
    const mockSpans: Span[] = [
      {
        span_id: "span-1",
        parent_id: null,
        trace_id: "trace-123",
        type: "agent",
        name: "Agent-With-Dashes & Special@Chars!",
        timestamps: {
          started_at: 1000,
          finished_at: 2000,
        },
      },
      {
        span_id: "span-2",
        parent_id: "span-1",
        trace_id: "trace-123",
        type: "llm",
        vendor: "openai",
        model: "gpt-4-turbo-preview",
        timestamps: {
          started_at: 1200,
          finished_at: 1800,
        },
      },
    ];

    const result = generateMermaidSyntax(mockSpans);

    const expectedSyntax = `sequenceDiagram
    actor Agent_With_Dashes___Special_Chars_ as Agent-With-Dashes & Special@Chars!
    participant gpt_4_turbo_preview as gpt-4-turbo-preview
    Agent_With_Dashes___Special_Chars_->>gpt_4_turbo_preview: LLM call
    activate gpt_4_turbo_preview
    gpt_4_turbo_preview-->>Agent_With_Dashes___Special_Chars_: ${INVISIBLE_RETURN}
    deactivate gpt_4_turbo_preview
`;

    expect(result).toBe(expectedSyntax);
  });

  it("should handle tool calls with proper labeling", () => {
    const mockSpans: Span[] = [
      {
        span_id: "span-1",
        parent_id: null,
        trace_id: "trace-123",
        type: "agent",
        name: "TestAgent",
        timestamps: {
          started_at: 1000,
          finished_at: 3000,
        },
      },
      {
        span_id: "span-2",
        parent_id: "span-1",
        trace_id: "trace-123",
        type: "tool",
        name: "search_database",
        timestamps: {
          started_at: 1200,
          finished_at: 1800,
        },
      },
    ];

    const result = generateMermaidSyntax(mockSpans);

    // Tool spans create self-calls, but tools are not participants
    const expectedSyntax = `sequenceDiagram
    actor TestAgent as TestAgent
    TestAgent->>TestAgent: tool: search_database
`;

    expect(result).toBe(expectedSyntax);
  });

  it("should maintain chronological order of interactions", () => {
    const mockSpans: Span[] = [
      {
        span_id: "span-1",
        parent_id: null,
        trace_id: "trace-123",
        type: "agent",
        name: "Agent1",
        timestamps: {
          started_at: 1000,
          finished_at: 5000,
        },
      },
      {
        span_id: "span-2",
        parent_id: "span-1",
        trace_id: "trace-123",
        type: "llm",
        model: "gpt-4",
        timestamps: {
          started_at: 3000, // Later timestamp
          finished_at: 3500,
        },
      },
      {
        span_id: "span-3",
        parent_id: "span-1",
        trace_id: "trace-123",
        type: "agent",
        name: "Agent2",
        timestamps: {
          started_at: 2000, // Earlier timestamp
          finished_at: 2500,
        },
      },
    ];

    const result = generateMermaidSyntax(mockSpans);

    // Should process interactions in chronological order
    const lines = result.split('\n').filter(line => line.includes('->>'));
    expect(lines.some(line => line.includes('Agent1->>Agent2: handover'))).toBe(true); // Earlier interaction first
    expect(lines.some(line => line.includes('Agent1->>gpt_4: LLM call'))).toBe(true); // Later interaction second
  });

  it("should handle tool calls and subsequent agent calls correctly", () => {
    // This test replicates the banking scenario structure from the user's trace
    const mockSpans: Span[] = [
      // Root agent
      {
        span_id: "bank-agent",
        parent_id: null,
        trace_id: "trace-123",
        type: "agent",
        name: "BankCustomerSupportAgent",
        timestamps: {
          started_at: 1000,
          finished_at: 8000,
        },
      },
      // LLM call that makes a tool call
      {
        span_id: "llm-1",
        parent_id: "bank-agent",
        trace_id: "trace-123",
        type: "llm",
        model: "gpt-4o-mini",
        timestamps: {
          started_at: 1200,
          finished_at: 2000,
        },
      },
      // Tool call (child of LLM)
      {
        span_id: "tool-call",
        parent_id: "llm-1",
        trace_id: "trace-123",
        type: "tool",
        name: "explore_customer_account",
        timestamps: {
          started_at: 1300,
          finished_at: 1900,
        },
      },
      // Customer explorer agent (called by the tool)
      {
        span_id: "customer-agent",
        parent_id: "tool-call",
        trace_id: "trace-123",
        type: "agent",
        name: "CustomerExplorerAgent",
        timestamps: {
          started_at: 1400,
          finished_at: 1800,
        },
      },
      // LLM call within customer agent
      {
        span_id: "llm-2",
        parent_id: "customer-agent",
        trace_id: "trace-123",
        type: "llm",
        model: "gpt-4o-mini",
        timestamps: {
          started_at: 1500,
          finished_at: 1700,
        },
      },
      // Final LLM call back in bank agent
      {
        span_id: "llm-3",
        parent_id: "bank-agent",
        trace_id: "trace-123",
        type: "llm",
        model: "gpt-4o-mini",
        timestamps: {
          started_at: 6100,
          finished_at: 7800,
        },
      },
    ];

    const result = generateMermaidSyntax(mockSpans);
    console.log("Tool call test result:", result);

    // Expected format with tool self-call but tools are not participants, LLM->Agent is "call"
    const expectedSyntax = `sequenceDiagram
    actor BankCustomerSupportAgent as BankCustomerSupportAgent
    participant gpt_4o_mini as gpt-4o-mini
    actor CustomerExplorerAgent as CustomerExplorerAgent
    BankCustomerSupportAgent->>gpt_4o_mini: LLM call
    activate gpt_4o_mini
    gpt_4o_mini->>gpt_4o_mini: tool: explore_customer_account
    gpt_4o_mini->>CustomerExplorerAgent: call
    activate CustomerExplorerAgent
    CustomerExplorerAgent->>gpt_4o_mini: LLM call
    activate gpt_4o_mini
    gpt_4o_mini-->>CustomerExplorerAgent: ${INVISIBLE_RETURN}
    deactivate gpt_4o_mini
    CustomerExplorerAgent-->>gpt_4o_mini: ${INVISIBLE_RETURN}
    deactivate CustomerExplorerAgent
    gpt_4o_mini-->>BankCustomerSupportAgent: ${INVISIBLE_RETURN}
    deactivate gpt_4o_mini
    BankCustomerSupportAgent->>gpt_4o_mini: LLM call
    activate gpt_4o_mini
    gpt_4o_mini-->>BankCustomerSupportAgent: ${INVISIBLE_RETURN}
    deactivate gpt_4o_mini
`;

    expect(result).toBe(expectedSyntax);
  });

  it("should handle stacked activations correctly", () => {
    // Test case where the same participant is called multiple times (stacked activations)
    const mockSpans: Span[] = [
      // Root agent
      {
        span_id: "agent-1",
        parent_id: null,
        trace_id: "trace-123",
        type: "agent",
        name: "MainAgent",
        timestamps: {
          started_at: 1000,
          finished_at: 6000,
        },
      },
      // First LLM call
      {
        span_id: "llm-1",
        parent_id: "agent-1",
        trace_id: "trace-123",
        type: "llm",
        model: "gpt-4",
        timestamps: {
          started_at: 1100,
          finished_at: 2000,
        },
      },
      // Second LLM call (stacked activation)
      {
        span_id: "llm-2",
        parent_id: "agent-1",
        trace_id: "trace-123",
        type: "llm",
        model: "gpt-4",
        timestamps: {
          started_at: 2100,
          finished_at: 3000,
        },
      },
    ];

    const result = generateMermaidSyntax(mockSpans);
    console.log("Stacked activations test result:", result);

    // Should show multiple activations on the same participant
    const lines = result.split('\n').filter(line => line.includes('->>') || line.includes('-->>'));

    // Should have two LLM calls to gpt_4
    const llmCalls = lines.filter(line => line.includes('MainAgent->>gpt_4'));
    expect(llmCalls.length).toBe(2);

    // Should have corresponding returns
    const returns = lines.filter(line => line.includes('gpt_4-->>MainAgent'));
    expect(returns.length).toBe(2);
  });

  it("should filter spans based on included span types", () => {
    const mockSpans: Span[] = [
      {
        span_id: "agent-span",
        parent_id: null,
        trace_id: "trace-123",
        type: "agent",
        name: "TestAgent",
        timestamps: { started_at: 1000, finished_at: 3000 },
      },
      {
        span_id: "llm-span",
        parent_id: "agent-span",
        trace_id: "trace-123",
        type: "llm",
        model: "gpt-4",
        timestamps: { started_at: 1500, finished_at: 2500 },
      },
      {
        span_id: "tool-span",
        parent_id: "llm-span",
        trace_id: "trace-123",
        type: "tool",
        name: "search_tool",
        timestamps: { started_at: 2000, finished_at: 2200 },
      },
      {
        span_id: "span-span",
        parent_id: "agent-span",
        trace_id: "trace-123",
        type: "span",
        name: "generic_span",
        timestamps: { started_at: 2500, finished_at: 2800 },
      },
    ];

    // Test with only agent and llm types
    const filteredResult = generateMermaidSyntax(mockSpans, ["agent", "llm"]);
    expect(filteredResult.includes("actor TestAgent as TestAgent")).toBe(true);
    expect(filteredResult.includes("participant gpt_4 as gpt-4")).toBe(true);
    expect(filteredResult.includes("tool: search_tool")).toBe(false); // tool should be excluded
    expect(filteredResult.includes("generic_span")).toBe(false); // span should be excluded

    // Test with tool, agent, and llm types (needed for tool self-calls to work)
    const toolIncludedResult = generateMermaidSyntax(mockSpans, ["tool", "agent", "llm"]);
    expect(toolIncludedResult.includes("TestAgent->>gpt_4: LLM call")).toBe(true);
    expect(toolIncludedResult.includes("gpt_4->>gpt_4: tool: search_tool")).toBe(true);

    // Test with only agent type (no llm or tool)
    const agentOnlyResult = generateMermaidSyntax(mockSpans, ["agent"]);
    expect(agentOnlyResult.includes("actor TestAgent as TestAgent")).toBe(true);
    expect(agentOnlyResult.includes("participant gpt_4 as gpt-4")).toBe(false); // llm should be excluded
    expect(agentOnlyResult.includes("tool: search_tool")).toBe(false); // tool should be excluded

    // Test with default (all except 'span')
    const defaultResult = generateMermaidSyntax(mockSpans);
    expect(defaultResult.includes("tool: search_tool")).toBe(true);
    expect(defaultResult.includes("generic_span")).toBe(false); // span should be excluded by default
  });

  it("should bridge connections when intermediate spans are filtered out", () => {
    const mockSpans: Span[] = [
      // Agent A
      {
        span_id: "agent-a",
        parent_id: null,
        trace_id: "trace-123",
        type: "agent",
        name: "AgentA",
        timestamps: { started_at: 1000, finished_at: 5000 },
      },
      // Generic span in the middle (should be filtered out by default)
      {
        span_id: "middle-span",
        parent_id: "agent-a",
        trace_id: "trace-123",
        type: "span",
        name: "execute_event_loop_cycle",
        timestamps: { started_at: 2000, finished_at: 4000 },
      },
      // LLM at the end
      {
        span_id: "llm-end",
        parent_id: "middle-span",
        trace_id: "trace-123",
        type: "llm",
        model: "gpt-4",
        timestamps: { started_at: 3000, finished_at: 3500 },
      },
    ];

    // With explicit filtering (agent, llm, tool - excludes 'span' type), should bridge AgentA -> LLM directly
    const result = generateMermaidSyntax(mockSpans, ["agent", "llm", "tool"]);

    const expectedBridged = `sequenceDiagram
    actor AgentA as AgentA
    participant gpt_4 as gpt-4
    AgentA->>gpt_4: LLM call
    activate gpt_4
    gpt_4-->>AgentA: ${INVISIBLE_RETURN}
    deactivate gpt_4
`;

    expect(result).toBe(expectedBridged);

    // With all types included, should show the full chain
    const fullResult = generateMermaidSyntax(mockSpans, ["agent", "span", "llm"]);

    const expectedFull = `sequenceDiagram
    actor AgentA as AgentA
    participant execute_event_loop_cycle as execute_event_loop_cycle
    participant gpt_4 as gpt-4
    AgentA->>execute_event_loop_cycle: execute_event_loop_cycle
    activate execute_event_loop_cycle
    execute_event_loop_cycle->>gpt_4: LLM call
    activate gpt_4
    gpt_4-->>execute_event_loop_cycle: ${INVISIBLE_RETURN}
    deactivate gpt_4
    execute_event_loop_cycle-->>AgentA: ${INVISIBLE_RETURN}
    deactivate execute_event_loop_cycle
`;

    expect(fullResult).toBe(expectedFull);
  });
});
