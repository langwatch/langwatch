import { setupObservability } from "langwatch/observability/node";
import { LangWatchCallbackHandler } from "langwatch/observability/instrumentation/langchain";
import { getLangWatchTracer } from "langwatch";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StateGraph, END, START } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import * as readline from "readline";
import cliMarkdown from "cli-markdown";
import { z } from "zod";

setupObservability();

const tracer = getLangWatchTracer("langgraph-sdk-example");

// Define the state schema using Zod
const GraphState = z.object({
  question: z.string(),
  current_step: z.string().default("start"),
  needs_search: z.boolean().default(false),
  search_results: z.string().default(""),
  analysis: z.string().default(""),
  final_answer: z.string().default(""),
  iterations: z.number().default(0),
});

type GraphStateType = z.infer<typeof GraphState>;

async function main() {
  const threadId = crypto.randomUUID();
  const langWatchCallback = new LangWatchCallbackHandler();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('🤖 LangGraph Research Agent started! Type "quit" to exit.');
  console.log("This demonstrates a real LangGraph workflow with:");
  console.log("1. Question Analysis Node");
  console.log("2. Search Decision Router");
  console.log("3. Web Search Node");
  console.log("4. Analysis Node");
  console.log("5. Answer Generation Node");
  console.log("6. Quality Control Node");
  console.log("---");

  // Initialize LangChain components
  const chatModel = new ChatOpenAI({
    modelName: "gpt-5",
  });

  // Mock search tool for demo purposes
  const performWebSearch = async (query: string): Promise<string> => {
    // Simulate search delay
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return `Mock search results for "${query}":
- Recent developments and current information
- Latest news and analysis from reliable sources
- Expert opinions and academic research
- Current market trends and data points`;
  };

  // Node 1: Analyze the question to determine if search is needed
  const analyzeQuestion = async (state: GraphStateType) => {
    console.log("🔍 [NODE] Analyzing question...");

    const prompt = `
    Analyze this question and determine if it requires current/recent information that would need web search.

    Question: ${state.question}

    Respond with just "YES" if web search is needed, "NO" if general knowledge is sufficient.
    `;

    const result = await chatModel.invoke([
      new SystemMessage(
        "You are a question analyzer. Respond with only YES or NO.",
      ),
      new HumanMessage(prompt),
    ]);

    const needsSearch = (result.content as string)
      .toUpperCase()
      .includes("YES");

    return {
      current_step: "question_analyzed",
      needs_search: needsSearch,
    };
  };

  // Node 2: Perform web search if needed
  const performSearch = async (state: GraphStateType) => {
    console.log("🔎 Performing web search...");

    const searchResults = await performWebSearch(state.question);

    return {
      current_step: "search_completed",
      search_results: searchResults,
    };
  };

  // Node 3: Analyze the information (with or without search results)
  const analyzeInformation = async (state: GraphStateType) => {
    console.log("🧠 Analyzing information...");

    const context = state.search_results
      ? `Search Results:\n${state.search_results}\n\n`
      : "Using general knowledge (no search performed).\n\n";

    const prompt = `
    ${context}Question: ${state.question}

    Provide a thorough analysis of this question, considering multiple perspectives and available information.
    `;

    const result = await chatModel.invoke([
      new SystemMessage(
        "You are an expert analyst. Provide comprehensive analysis.",
      ),
      new HumanMessage(prompt),
    ]);

    return {
      current_step: "analysis_completed",
      analysis: result.content as string,
    };
  };

  // Node 4: Generate the final answer
  const generateAnswer = async (state: GraphStateType) => {
    console.log("✍️ Generating final answer...");

    const prompt = `
    Question: ${state.question}

    Analysis: ${state.analysis}

    ${state.search_results ? `Search Results: ${state.search_results}` : ""}

    Based on the analysis and available information, provide a comprehensive, well-structured answer.
    `;

    const result = await chatModel.invoke([
      new SystemMessage(
        "You are a helpful assistant. Provide clear, comprehensive answers.",
      ),
      new HumanMessage(prompt),
    ]);

    return {
      current_step: "answer_generated",
      final_answer: result.content as string,
    };
  };

  // Node 5: Quality control check
  const qualityControl = async (state: GraphStateType) => {
    console.log("✅ Performing quality control...");

    // Simple quality checks
    const answerLength = state.final_answer?.length || 0;
    const hasStructure = state.final_answer?.includes("\n") || false;
    const iterations = state.iterations + 1;

    if (answerLength < 100 || !hasStructure) {
      if (iterations < 3) {
        console.log("⚠️ Quality check failed - retrying...");
        return {
          current_step: "quality_failed",
          iterations,
          final_answer: "", // Clear for retry
        };
      }
    }

    console.log("✅ Quality check passed!");
    return {
      current_step: "completed",
      iterations,
    };
  };

  // Router function to determine the next step
  const router = (state: GraphStateType): string => {
    console.log(`🔀 [ROUTER] Current step: ${state.current_step}`);

    switch (state.current_step) {
      case "question_analyzed":
        return state.needs_search ? "search" : "analyze";
      case "search_completed":
        return "analyze";
      case "analysis_completed":
        return "generate_answer";
      case "answer_generated":
        return "quality_control";
      case "quality_failed":
        return "generate_answer"; // Retry
      case "completed":
        return END;
      default:
        return "analyze_question";
    }
  };

  // Build the StateGraph using the modern API
  const workflow = new StateGraph(GraphState)
    .addNode("analyze_question", analyzeQuestion)
    .addNode("search", performSearch)
    .addNode("analyze", analyzeInformation)
    .addNode("generate_answer", generateAnswer)
    .addNode("quality_control", qualityControl)
    .addEdge(START, "analyze_question")
    .addConditionalEdges("analyze_question", router, {
      search: "search",
      analyze: "analyze",
    })
    .addConditionalEdges("search", router, {
      analyze: "analyze",
    })
    .addConditionalEdges("analyze", router, {
      generate_answer: "generate_answer",
    })
    .addConditionalEdges("generate_answer", router, {
      quality_control: "quality_control",
    })
    .addConditionalEdges("quality_control", router, {
      generate_answer: "generate_answer",
      [END]: END,
    });

  // Compile the graph with memory
  const memory = new MemorySaver();
  const app = workflow
    .compile({ checkpointer: memory })
    .withConfig({ callbacks: [langWatchCallback] });

  // Main interaction loop
  while (true) {
    let finish = false;

    await tracer.withActiveSpan(
      "Workflow",
      {
        attributes: {
          "langwatch.thread_id": threadId,
          "langwatch.tags": ["langgraph", "research-agent", "multi-step"],
        },
      },
      async (span) => {
        span.setType("workflow");

        try {
          // Get user input
          const userInput = await new Promise<string>((resolve) => {
            rl.question("❓ Ask me anything: ", resolve);
          });

          // Check for exit command
          if (
            userInput.toLowerCase() === "quit" ||
            userInput.toLowerCase() === "exit"
          ) {
            console.log("👋 Goodbye!");
            finish = true;
            return;
          }

          // Skip empty input
          if (!userInput.trim()) {
            return;
          }

          console.log("🤖 Processing through LangGraph research workflow...");
          console.log(
            "📊 Graph nodes: analyze_question → [search?] → analyze → generate_answer → quality_control",
          );
          console.log("---");

          // Create initial state
          const initialState: GraphStateType = {
            question: userInput,
            current_step: "start",
            needs_search: false,
            search_results: "",
            analysis: "",
            final_answer: "",
            iterations: 0,
          };

          // Execute the workflow with streaming
          const config = {
            configurable: { thread_id: threadId },
          };

          console.log("🚀 Starting LangGraph execution...");
          let finalState: GraphStateType = initialState;

          // Stream through each node execution
          for await (const step of await app.stream(initialState, config)) {
            const nodeNames = Object.keys(step);
            console.log(`📍 Executed nodes: ${nodeNames.join(", ")}`);

            // Update final state with all node outputs
            for (const nodeName of nodeNames) {
              const nodeOutput = (step as any)[nodeName];
              if (nodeOutput && typeof nodeOutput === "object") {
                finalState = { ...finalState, ...nodeOutput };
              }
            }
          }

          console.log("✅ LangGraph workflow completed!");
          console.log("---");

          // Display results
          if (finalState.final_answer) {
            console.log("🎯 Final Answer:");
            console.log(
              cliMarkdown(finalState.final_answer, {
                colors: true,
                maxWidth: 80,
                theme: {
                  heading: "cyan",
                  link: "blue",
                  code: "green",
                  blockquote: "yellow",
                },
              }),
            );
          }

          // Show workflow statistics
          console.log(`\n📈 Workflow Statistics:`);
          console.log(
            `   Search performed: ${finalState.needs_search ? "Yes" : "No"}`,
          );
          console.log(`   Total iterations: ${finalState.iterations}`);
          console.log(`   Final step: ${finalState.current_step}`);
          console.log("---");
        } catch (error) {
          console.error("❌ Error:", error);
          console.log("Please try again.");
        }
      },
    );

    if (finish) {
      break;
    }
  }

  rl.close();
}

// Run the research workflow
main().catch(console.error);
