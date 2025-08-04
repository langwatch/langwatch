import { setupLangWatch } from "langwatch/node";
import { LangWatchCallbackHandler } from "langwatch/observability/instrumentation/langchain";
import { getLangWatchTracer } from "langwatch";
import { semconv } from "langwatch/observability";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import * as readline from "readline";
import cliMarkdown from "cli-markdown";

await setupLangWatch();

const tracer = getLangWatchTracer("langgraph-sdk-example");

// Define the state interface for our multi-agent workflow
interface WorkflowState {
  userQuery: string;
  analysis: string;
  recommendation: string;
  finalResponse: string;
}

async function main() {
  const threadId = crypto.randomUUID();
  const langWatchCallback = new LangWatchCallbackHandler();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('🤖 Multi-Agent Workflow started! Type "quit" to exit.');
  console.log("This example demonstrates a workflow with:");
  console.log("1. Query Analysis Agent");
  console.log("2. Recommendation Agent");
  console.log("3. Response Synthesis Agent");
  console.log("---");

  // Initialize LangChain chat model
  const chatModel = new ChatOpenAI({
    modelName: "gpt-4o-mini",
    temperature: 0.7,
    callbacks: [langWatchCallback],
  });

  // Agent 1: Query Analysis Agent
  const analyzeQuery = async (userQuery: string): Promise<string> => {
    const analysisPrompt = new SystemMessage(
      "You are an expert at analyzing user queries. Analyze the user's query and provide insights about what they're asking for, their intent, and any specific requirements."
    );

    const result = await chatModel.invoke([
      analysisPrompt,
      new HumanMessage(`Analyze this query: ${userQuery}`)
    ]);

    return result.content as string;
  };

  // Agent 2: Recommendation Agent
  const generateRecommendation = async (userQuery: string, analysis: string): Promise<string> => {
    const recommendationPrompt = new SystemMessage(
      "You are an expert at providing helpful recommendations. Based on the analysis, provide specific, actionable recommendations."
    );

    const result = await chatModel.invoke([
      recommendationPrompt,
      new HumanMessage(`Based on this analysis: ${analysis}\n\nProvide recommendations for: ${userQuery}`)
    ]);

    return result.content as string;
  };

  // Agent 3: Response Synthesis Agent
  const synthesizeResponse = async (userQuery: string, analysis: string, recommendation: string): Promise<string> => {
    const synthesisPrompt = new SystemMessage(
      "You are an expert at synthesizing information into clear, helpful responses. Combine the analysis and recommendations into a comprehensive, well-structured response."
    );

    const result = await chatModel.invoke([
      synthesisPrompt,
      new HumanMessage(`Original Query: ${userQuery}\n\nAnalysis: ${analysis}\n\nRecommendations: ${recommendation}\n\nSynthesize this into a comprehensive response.`)
    ]);

    return result.content as string;
  };

  // Main workflow function
  const runWorkflow = async (userQuery: string): Promise<WorkflowState> => {
    console.log("🔍 Step 1: Analyzing query...");
    const analysis = await analyzeQuery(userQuery);

    console.log("💡 Step 2: Generating recommendations...");
    const recommendation = await generateRecommendation(userQuery, analysis);

    console.log("🎯 Step 3: Synthesizing final response...");
    const finalResponse = await synthesizeResponse(userQuery, analysis, recommendation);

    return {
      userQuery,
      analysis,
      recommendation,
      finalResponse,
    };
  };

  while (true) {
    let finish = false;

    await tracer.withActiveSpan("workflow_iteration", {
      attributes: {
        [semconv.ATTR_LANGWATCH_THREAD_ID]: threadId,
      },
    }, async (span) => {
      try {
        // Get user input
        const userInput = await new Promise<string>((resolve) => {
          rl.question("You: ", resolve);
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

        console.log("🤖 Processing through multi-agent workflow...");

        // Execute the workflow
        const result = await runWorkflow(userInput);

        // Display the workflow results
        console.log("\n📊 Workflow Results:");
        console.log("---");

        console.log("🔍 Analysis:");
        console.log(cliMarkdown(result.analysis, {
          colors: true,
          maxWidth: 80,
          theme: {
            heading: "cyan",
            link: "blue",
            code: "green",
            blockquote: "yellow",
          },
        }));

        console.log("\n💡 Recommendations:");
        console.log(cliMarkdown(result.recommendation, {
          colors: true,
          maxWidth: 80,
          theme: {
            heading: "cyan",
            link: "blue",
            code: "green",
            blockquote: "yellow",
          },
        }));

        console.log("\n🎯 Final Response:");
        console.log(cliMarkdown(result.finalResponse, {
          colors: true,
          maxWidth: 80,
          theme: {
            heading: "cyan",
            link: "blue",
            code: "green",
            blockquote: "yellow",
          },
        }));

        console.log("---");
      } catch (error) {
        console.error("❌ Error:", error);
        console.log("Please try again.");
      }
    });

    if (finish) {
      break;
    }
  }

  rl.close();
}

// Run the multi-agent workflow
main().catch(console.error);
