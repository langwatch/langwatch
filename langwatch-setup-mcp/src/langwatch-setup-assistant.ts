// LangWatch Setup Assistant - Core Functions
// Based on LangWatch documentation at https://docs.langwatch.ai/

export async function getSetupGuide(
  language?: "python" | "typescript" | "javascript" | "rest_api",
  framework?: string
): Promise<string> {
  const baseIntro = `# 🚀 LangWatch Setup Guide

LangWatch is an all-in-one open-source LLMops platform that allows you to track, monitor, guardrail and evaluate your LLM applications.

## Quick Start

1. **Sign up**: Visit https://app.langwatch.ai/ 
2. **Get API Key**: Navigate to Settings → API Keys and create a new key (starts with \`sk-lw-\`)
3. **Install SDK**: Choose your language below
4. **Integrate**: Add LangWatch to your application

---
`;

  if (!language) {
    return (
      baseIntro +
      `
## Choose Your Language

- **Python**: \`pip install langwatch\`
- **TypeScript/JavaScript**: \`npm install langwatch\`
- **REST API**: Direct HTTP calls to LangWatch API

Run \`get_setup_guide\` with a specific language for detailed instructions.

## Demo & Resources

- 🎬 [Watch Demo Video](https://www.loom.com/share/17f827b1f5a648298779b36e2dc959e6)
- 🎮 [Try Live Demo](https://app.langwatch.ai/demo)
- 📚 [Full Documentation](https://docs.langwatch.ai/)
- 💬 [Join Discord](https://discord.gg/kT4PhDS2gH)
- 📧 [Email Support](mailto:support@langwatch.ai)
`
    );
  }

  switch (language) {
    case "python":
      return (
        baseIntro +
        `
## Python Setup

### 1. Install LangWatch
\`\`\`bash
pip install langwatch
\`\`\`

### 2. Basic Setup
\`\`\`python
import langwatch
import os

# Initialize LangWatch
langwatch.setup(
    api_key=os.getenv("LANGWATCH_API_KEY"),
    # Optional: endpoint_url for self-hosted instances
)
\`\`\`

### 3. Environment Variables
\`\`\`bash
export LANGWATCH_API_KEY="sk-lw-your-api-key-here"
\`\`\`

### 4. Basic Usage
\`\`\`python
import langwatch

@langwatch.trace()
def my_llm_function(user_input: str):
    # Your LLM call here
    response = "Generated response"
    return response

# Call your function
result = my_llm_function("Hello, how are you?")
\`\`\`

${framework ? getFrameworkSpecificGuide("python", framework) : ""}

**Next steps**: Run \`get_integration_example\` for detailed integration examples!
`
      );

    case "typescript":
    case "javascript":
      return (
        baseIntro +
        `
## TypeScript/JavaScript Setup

### 1. Install LangWatch
\`\`\`bash
npm install langwatch
# or
yarn add langwatch
\`\`\`

### 2. Basic Setup
\`\`\`typescript
import { LangWatch } from "langwatch";

const langwatch = new LangWatch({
  apiKey: process.env.LANGWATCH_API_KEY!,
  // Optional: endpoint for self-hosted instances
});
\`\`\`

### 3. Environment Variables
\`\`\`bash
export LANGWATCH_API_KEY="sk-lw-your-api-key-here"
\`\`\`

### 4. Basic Usage
\`\`\`typescript
const trace = langwatch.startTrace({
  user_id: "user-123",
  thread_id: "conversation-456"
});

const span = trace.startLLMSpan({
  name: "chat_completion",
  input: "Hello, how are you?",
  model: "gpt-4"
});

// Your LLM call here
const response = "Generated response";

span.end({ output: response });
trace.end();
\`\`\`

${framework ? getFrameworkSpecificGuide("typescript", framework) : ""}

**Next steps**: Run \`get_integration_example\` for detailed integration examples!
`
      );

    case "rest_api":
      return (
        baseIntro +
        `
## REST API Integration

### Endpoint
\`POST https://app.langwatch.ai/api/collector\`

### Headers
\`\`\`
X-Auth-Token: sk-lw-your-api-key-here
Content-Type: application/json
\`\`\`

### Basic Request Body
\`\`\`json
{
  "trace_id": "unique-trace-id",
  "spans": [{
    "span_id": "unique-span-id",
    "type": "llm",
    "name": "chat_completion",
    "input": {
      "type": "chat_messages",
      "value": [{"role": "user", "content": "Hello!"}]
    },
    "output": {
      "type": "chat_messages", 
      "value": [{"role": "assistant", "content": "Hi there!"}]
    },
    "timestamps": {
      "started_at": 1634567890000,
      "finished_at": 1634567892000
    },
    "params": {
      "model": "gpt-4",
      "temperature": 0.7
    },
    "metrics": {
      "prompt_tokens": 10,
      "completion_tokens": 5,
      "total_cost": 0.001
    }
  }],
  "metadata": {
    "user_id": "user-123",
    "thread_id": "conversation-456"
  }
}
\`\`\`

### cURL Example
\`\`\`bash
curl -X POST "https://app.langwatch.ai/api/collector" \\
  -H "X-Auth-Token: sk-lw-your-api-key-here" \\
  -H "Content-Type: application/json" \\
  -d @trace_data.json
\`\`\`

**Next steps**: Run \`get_integration_example\` for more detailed examples!
`
      );

    default:
      return baseIntro;
  }
}

export async function getIntegrationExample(
  language: "python" | "typescript" | "javascript",
  integration_type:
    | "basic"
    | "openai"
    | "anthropic"
    | "custom_llm"
    | "evaluation"
): Promise<string> {
  const intro = `# 🔧 ${language.toUpperCase()} Integration Example: ${integration_type}\n\n`;

  if (language === "python") {
    switch (integration_type) {
      case "basic":
        return (
          intro +
          `
\`\`\`python
import langwatch
import os

# Setup
langwatch.setup(api_key=os.getenv("LANGWATCH_API_KEY"))

@langwatch.trace()
def chat_with_user(user_input: str, user_id: str = None):
    # This automatically creates a trace
    
    # Add metadata
    langwatch.get_current_trace().update(
        user_id=user_id,
        metadata={"source": "web_chat"}
    )
    
    # Your LLM logic here
    response = f"Response to: {user_input}"
    
    return response

# Usage
result = chat_with_user("What's the weather?", user_id="user123")
\`\`\`
`
        );

      case "openai":
        return (
          intro +
          `
\`\`\`python
import langwatch
import openai
import os

# Setup
langwatch.setup(api_key=os.getenv("LANGWATCH_API_KEY"))
client = openai.OpenAI()

@langwatch.trace()
def openai_chat(messages: list, user_id: str = None):
    # Start an LLM span
    with langwatch.span(type="llm") as span:
        span.update(
            name="openai_chat",
            input=messages,
            model="gpt-4"
        )
        
        # Make OpenAI call
        response = client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            temperature=0.7
        )
        
        # Update span with results
        span.update(
            output=response.choices[0].message.content,
            metrics={
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_cost": response.usage.total_tokens * 0.00003  # example pricing
            }
        )
        
        return response.choices[0].message.content

# Usage
messages = [{"role": "user", "content": "Hello!"}]
result = openai_chat(messages, user_id="user123")
\`\`\`
`
        );

      case "evaluation":
        return (
          intro +
          `
\`\`\`python
import langwatch
import os

# Setup
langwatch.setup(api_key=os.getenv("LANGWATCH_API_KEY"))

@langwatch.trace()
def llm_with_evaluation(user_input: str):
    # Your LLM call
    response = "Generated response"
    
    # Add custom evaluation
    langwatch.get_current_span().add_evaluation(
        name="response_quality",
        passed=True,
        score=0.85,
        label="high_quality",
        details="Response is relevant and helpful"
    )
    
    # You can also add evaluations to the trace level
    langwatch.get_current_trace().add_evaluation(
        name="conversation_flow",
        passed=True,
        score=0.9
    )
    
    return response

result = llm_with_evaluation("What's AI?")
\`\`\`
`
        );

      default:
        return (
          intro +
          "Run with integration_type: 'basic', 'openai', 'anthropic', 'custom_llm', or 'evaluation'"
        );
    }
  }

  if (language === "typescript" || language === "javascript") {
    switch (integration_type) {
      case "basic":
        return (
          intro +
          `
\`\`\`typescript
import { LangWatch } from "langwatch";

const langwatch = new LangWatch({
  apiKey: process.env.LANGWATCH_API_KEY!
});

async function chatWithUser(userInput: string, userId?: string) {
  const trace = langwatch.startTrace({
    user_id: userId,
    metadata: { source: "web_chat" }
  });

  const span = trace.startLLMSpan({
    name: "chat_response",
    input: userInput,
    model: "gpt-4"
  });

  try {
    // Your LLM logic here
    const response = \`Response to: \${userInput}\`;
    
    span.end({ output: response });
    return response;
  } catch (error) {
    span.end({ error: error.message });
    throw error;
  } finally {
    trace.end();
  }
}

// Usage
const result = await chatWithUser("What's the weather?", "user123");
\`\`\`
`
        );

      case "openai":
        return (
          intro +
          `
\`\`\`typescript
import { LangWatch } from "langwatch";
import OpenAI from "openai";

const langwatch = new LangWatch({
  apiKey: process.env.LANGWATCH_API_KEY!
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

async function openaiChat(messages: any[], userId?: string) {
  const trace = langwatch.startTrace({
    user_id: userId,
    thread_id: \`conversation-\${Date.now()}\`
  });

  const span = trace.startLLMSpan({
    name: "openai_chat",
    input: messages,
    model: "gpt-4"
  });

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
      temperature: 0.7
    });

    const content = response.choices[0].message.content;
    
    span.end({
      output: content,
      metrics: {
        prompt_tokens: response.usage?.prompt_tokens,
        completion_tokens: response.usage?.completion_tokens,
        total_cost: (response.usage?.total_tokens || 0) * 0.00003
      }
    });

    return content;
  } catch (error) {
    span.end({ error: error.message });
    throw error;
  } finally {
    trace.end();
  }
}

// Usage
const messages = [{ role: "user", content: "Hello!" }];
const result = await openaiChat(messages, "user123");
\`\`\`
`
        );

      default:
        return (
          intro +
          "Run with integration_type: 'basic', 'openai', 'anthropic', 'custom_llm', or 'evaluation'"
        );
    }
  }

  return intro + "Language not supported";
}

export async function getConceptsExplanation(
  concept:
    | "traces"
    | "spans"
    | "threads"
    | "user_id"
    | "customer_id"
    | "labels"
    | "all"
): Promise<string> {
  const intro = `# 📚 LangWatch Concepts\n\n`;

  const concepts = {
    traces: `## 🔍 Traces (trace_id)

A **Trace** represents a single, complete task performed by your AI - one round trip from input to output.

**Examples:**
- Travel Bot: "What are the cheapest flights to Bali?" = One Trace
- Blog Tool: "Generate headline options" = One Trace  
- Customer Support: "Help me reset my password" = One Trace

Each trace captures the entire end-to-end generation, no matter how many internal steps it takes.`,

    spans: `## 🧱 Spans (span_id)

**Spans** are the individual steps or operations *within* a single Trace - the building blocks.

**Examples:**
- Travel Bot Trace might have:
  - Span 1: LLM call to understand destination preferences
  - Span 2: API query to airline database  
  - Span 3: LLM call to format the response
  
- Blog Tool Trace might have:
  - Span 1: Initial text generation
  - Span 2: Self-critique evaluation
  - Span 3: Text refinement based on critique

Each span represents a specific action or LLM call in your pipeline.`,

    threads: `## 💬 Threads (thread_id)

A **Thread** is the entire conversation or session - it groups *all* related Traces together.

**Examples:**
- Travel Bot: Complete chat from "Where should I go?" through flight booking
- Blog Tool: Entire session from brainstorming to final draft
- Customer Support: Full support conversation with multiple questions

Think of it as the complete user journey or conversation context.`,

    user_id: `## 👤 User ID (user_id)

The **User ID** identifies the actual end-user interacting with your AI application.

**Usage:**
- Link traces back to specific users
- Analyze user behavior patterns
- Filter traces by user for debugging
- Track user satisfaction over time

Usually this is the user's account ID in your system.`,

    customer_id: `## 🏢 Customer ID (customer_id)

The **Customer ID** is for platform builders who serve multiple organizations.

**When to use:**
- You're building AI tools for other companies
- Each company is a "customer" using your platform
- You want to provide per-customer analytics
- You need isolated data views for each customer

Perfect for B2B SaaS platforms offering AI capabilities.`,

    labels: `## 🏷️ Labels

**Labels** are flexible tags for organizing, filtering, and experimenting with your traces.

**Examples:**
- **Categorize:** \`"blog_title"\`, \`"blog_content"\`, \`"customer_support"\`
- **Version tracking:** \`"prompt_v1.0"\`, \`"prompt_v1.1"\`  
- **A/B Testing:** \`"experiment_a"\`, \`"experiment_b"\`
- **Features:** \`"translation"\`, \`"summarization"\`

Labels are your secret weapon for slicing and analyzing data in the LangWatch dashboard.`,
  };

  if (concept === "all") {
    return intro + Object.values(concepts).join("\n\n");
  }

  return intro + (concepts[concept] || "Concept not found");
}

export async function getTroubleshootingHelp(
  issue:
    | "no_traces_appearing"
    | "authentication_error"
    | "performance_impact"
    | "missing_data"
    | "installation_error"
    | "general"
): Promise<string> {
  const intro = `# 🛠️ LangWatch Troubleshooting\n\n`;

  switch (issue) {
    case "no_traces_appearing":
      return (
        intro +
        `
## ❌ No Traces Appearing in Dashboard

### Check List:
1. **API Key**: Ensure your API key starts with \`sk-lw-\`
2. **Network**: Verify connection to \`https://app.langwatch.ai\`
3. **Project**: Check you're looking at the correct project
4. **Time Range**: Expand the time filter in dashboard
5. **Integration**: Verify your code is actually calling LangWatch

### Python Debug:
\`\`\`python
import langwatch
import os

# Enable debug mode
langwatch.setup(
    api_key=os.getenv("LANGWATCH_API_KEY"),
    debug=True
)

# Test with a simple trace
@langwatch.trace()
def test_trace():
    print("This should appear in LangWatch!")
    return "test"

test_trace()
\`\`\`

### Check Network:
\`\`\`bash
curl -X POST "https://app.langwatch.ai/api/collector" \\
  -H "X-Auth-Token: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"test": true}'
\`\`\`
`
      );

    case "authentication_error":
      return (
        intro +
        `
## 🔐 Authentication Errors

### Common Issues:
1. **Invalid API Key**: Key must start with \`sk-lw-\`
2. **Expired Key**: Check if key is still active in Settings
3. **Environment Variable**: Verify \`LANGWATCH_API_KEY\` is set
4. **Project Access**: Ensure key has access to the project

### Verify API Key:
\`\`\`bash
export LANGWATCH_API_KEY="sk-lw-your-key-here"
echo $LANGWATCH_API_KEY
\`\`\`

### Test Authentication:
\`\`\`python
import langwatch
import requests
import os

api_key = os.getenv("LANGWATCH_API_KEY")
print(f"Using API key: {api_key[:10]}...")

# Test the endpoint
response = requests.post(
    "https://app.langwatch.ai/api/collector",
    headers={"X-Auth-Token": api_key},
    json={"test": True}
)
print(f"Status: {response.status_code}")
\`\`\`
`
      );

    case "performance_impact":
      return (
        intro +
        `
## ⚡ Performance Impact Concerns

### LangWatch is designed to be lightweight:

1. **Async by default**: Non-blocking trace collection
2. **Batch processing**: Efficient data transmission
3. **Minimal overhead**: < 1% performance impact
4. **Smart sampling**: Can sample traces in high-volume scenarios

### Optimize Performance:
\`\`\`python
import langwatch

# Configure for high-volume scenarios
langwatch.setup(
    api_key=os.getenv("LANGWATCH_API_KEY"),
    # Sample only 10% of traces in production
    sample_rate=0.1,
    # Batch size for efficiency
    batch_size=100
)
\`\`\`

### Monitor Impact:
\`\`\`python
import time

start = time.time()
# Your LLM call with LangWatch
result = my_llm_function()
end = time.time()

print(f"Total time with LangWatch: {end - start:.3f}s")
\`\`\`
`
      );

    case "missing_data":
      return (
        intro +
        `
## 📊 Missing Data in Traces

### Common Missing Data:
1. **Metrics**: Token counts, costs, timing
2. **Metadata**: User IDs, thread IDs  
3. **Evaluations**: Quality scores
4. **Context**: Input/output truncated

### Ensure Complete Data:
\`\`\`python
import langwatch

@langwatch.trace()
def complete_trace_example(user_input: str):
    # Set metadata
    langwatch.get_current_trace().update(
        user_id="user123",
        thread_id="conversation456",
        metadata={
            "source": "web_chat",
            "version": "1.0.0"
        }
    )
    
    with langwatch.span(type="llm") as span:
        span.update(
            name="gpt4_call",
            input=user_input,
            model="gpt-4",
            params={"temperature": 0.7}
        )
        
        # Your LLM call
        response = "Generated response"
        
        span.update(
            output=response,
            metrics={
                "prompt_tokens": 50,
                "completion_tokens": 30, 
                "total_cost": 0.002
            }
        )
        
        return response
\`\`\`
`
      );

    case "installation_error":
      return (
        intro +
        `
## 📦 Installation Errors

### Python Issues:
\`\`\`bash
# Try upgrading pip first
pip install --upgrade pip

# Install LangWatch
pip install langwatch

# If that fails, try:
pip install --no-cache-dir langwatch

# For conda environments:
conda install -c conda-forge pip
pip install langwatch
\`\`\`

### Node.js Issues:
\`\`\`bash
# Clear npm cache
npm cache clean --force

# Install LangWatch
npm install langwatch

# If using Yarn:
yarn add langwatch

# For permission errors:
sudo npm install -g langwatch
\`\`\`

### Common Fixes:
1. **Python version**: Requires Python 3.8+
2. **Node version**: Requires Node.js 16+
3. **Network**: Check corporate firewall/proxy
4. **Permissions**: Use virtual environments
`
      );

    default:
      return (
        intro +
        `
## 🆘 General Troubleshooting

### Step-by-Step Debug:

1. **Verify Installation**:
   \`\`\`bash
   pip list | grep langwatch  # Python
   npm list langwatch         # Node.js
   \`\`\`

2. **Check API Key**:
   - Starts with \`sk-lw-\`
   - Active in LangWatch dashboard
   - Properly set in environment

3. **Test Connection**:
   - Can reach \`https://app.langwatch.ai\`
   - No corporate firewall blocking
   - Check proxy settings

4. **Enable Debug Mode**:
   \`\`\`python
   langwatch.setup(debug=True)  # Python
   \`\`\`

5. **Check Dashboard**:
   - Correct project selected
   - Appropriate time range
   - No filters hiding data

### Get Help:
- 📧 Email: support@langwatch.ai
- 💬 Discord: https://discord.gg/kT4PhDS2gH
- 🐛 GitHub Issues: https://github.com/langwatch/langwatch/issues
`
      );
  }
}

export async function getEvaluationSetup(
  evaluator_type: "custom" | "langevals" | "built_in" | "all"
): Promise<string> {
  const intro = `# 🎯 LangWatch Evaluation Setup\n\n`;

  switch (evaluator_type) {
    case "custom":
      return (
        intro +
        `
## 🔧 Custom Evaluators

Add your own evaluation logic and capture results in LangWatch:

### Python:
\`\`\`python
import langwatch

@langwatch.span(type="evaluation")
def custom_evaluation_step():
    # Your custom evaluation logic
    relevance_score = calculate_relevance()
    is_safe = check_safety()
    
    # Add evaluation to current span
    langwatch.get_current_span().add_evaluation(
        name="content_relevance",
        score=relevance_score,
        passed=relevance_score > 0.8,
        label="high_relevance" if relevance_score > 0.8 else "low_relevance",
        details=f"Relevance score: {relevance_score:.2f}"
    )
    
    # Add safety evaluation
    langwatch.get_current_span().add_evaluation(
        name="safety_check",
        passed=is_safe,
        details="Content passed safety guidelines" if is_safe else "Content flagged"
    )
\`\`\`

### TypeScript:
\`\`\`typescript
import { LangWatchTrace } from "langwatch";

async function customEvaluation(trace: LangWatchTrace, content: string) {
    const span = trace.startSpan({ name: "custom_evaluation", type: "evaluation" });
    
    // Your evaluation logic
    const relevanceScore = await calculateRelevance(content);
    const isSafe = await checkSafety(content);
    
    span.addEvaluation({
        name: "content_relevance",
        score: relevanceScore,
        passed: relevanceScore > 0.8,
        details: \`Relevance score: \${relevanceScore.toFixed(2)}\`
    });
    
    span.end();
}
\`\`\`

### REST API:
\`\`\`bash
curl -X POST "https://app.langwatch.ai/api/collector" \\
  -H "X-Auth-Token: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "trace_id": "your-trace-id",
    "evaluations": [{
      "name": "custom_evaluation",
      "score": 0.85,
      "passed": true,
      "details": "Custom evaluation results"
    }]
  }'
\`\`\`
`
      );

    case "langevals":
      return (
        intro +
        `
## 🧮 LangEvals Integration

LangEvals provides pre-built evaluators for common LLM tasks:

### Installation:
\`\`\`bash
pip install langevals
\`\`\`

### Available Evaluators:
- **Relevance**: Content relevance to query
- **Coherence**: Text coherence and flow  
- **Fluency**: Language fluency
- **Toxicity**: Content safety
- **Factual Consistency**: Fact checking
- **Answer Relevance**: Answer quality

### Usage Example:
\`\`\`python
import langwatch
from langevals import evaluate

@langwatch.trace()
def llm_with_langevals(query: str):
    # Your LLM call
    response = get_llm_response(query)
    
    # Run LangEvals evaluations
    evaluations = evaluate(
        data=[{
            "input": query,
            "output": response
        }],
        evaluators=[
            "relevance",
            "coherence", 
            "toxicity"
        ]
    )
    
    # Add evaluations to current trace
    for eval_result in evaluations:
        langwatch.get_current_trace().add_evaluation(
            name=eval_result.evaluator,
            score=eval_result.score,
            passed=eval_result.passed,
            details=eval_result.details
        )
    
    return response
\`\`\`

### Batch Evaluation:
\`\`\`python
from langevals import evaluate

# Evaluate multiple examples
results = evaluate(
    data=[
        {"input": "What is AI?", "output": "AI is artificial intelligence..."},
        {"input": "Explain ML", "output": "Machine learning is..."}
    ],
    evaluators=["relevance", "coherence", "fluency"]
)
\`\`\`
`
      );

    case "built_in":
      return (
        intro +
        `
## 🏗️ Built-in LangWatch Evaluators

LangWatch provides several built-in evaluators you can enable:

### Available Evaluators:
1. **Response Time**: Track latency
2. **Token Usage**: Monitor token consumption  
3. **Cost Tracking**: Calculate costs
4. **Error Detection**: Catch failures
5. **Input/Output Length**: Monitor message sizes

### Enable in Dashboard:
1. Go to your project settings
2. Navigate to "Evaluations" tab
3. Toggle on desired evaluators
4. Configure thresholds and alerts

### Automatic Metrics:
\`\`\`python
import langwatch

@langwatch.trace()
def tracked_llm_call():
    # These metrics are automatically captured:
    # - Response time
    # - Token counts (if available)
    # - Costs (if configured)
    # - Success/failure status
    
    response = your_llm_call()
    return response
\`\`\`

### Custom Thresholds:
Configure alerts when:
- Response time > 5 seconds
- Cost per trace > $0.10
- Token usage > 4000 tokens
- Error rate > 5%
`
      );

    default:
      return (
        intro +
        `
## 🎯 All Evaluation Types

LangWatch supports multiple evaluation approaches:

### 1. Custom Evaluators
- Build your own evaluation logic
- Capture results in traces
- Perfect for domain-specific metrics

### 2. LangEvals Integration  
- Pre-built evaluators for common tasks
- Relevance, coherence, safety, etc.
- Easy integration with existing evaluators

### 3. Built-in Evaluators
- Automatic performance metrics
- Response time, costs, token usage
- Error detection and monitoring

### Getting Started:
1. Run \`get_evaluation_setup custom\` for custom evaluators
2. Run \`get_evaluation_setup langevals\` for LangEvals
3. Run \`get_evaluation_setup built_in\` for built-in options

### Best Practices:
- Combine multiple evaluation types
- Set up alerts for critical metrics
- Use labels to organize evaluations
- Review evaluation results regularly
`
      );
  }
}

export async function getAnnotationGuide(
  feature: "annotations" | "queues" | "scoring" | "collaboration" | "all"
): Promise<string> {
  const intro = `# 📝 LangWatch Annotations & Collaboration\n\n`;

  switch (feature) {
    case "annotations":
      return (
        intro +
        `
## 📝 Creating Annotations

Annotations let you add comments, feedback, and additional context to messages:

### How to Annotate:
1. **Click any message** in your traces view
2. **Trace details drawer** opens on the right
3. **Click the annotation button** (top right)
4. **Add your comment** or additional information
5. **Save** the annotation

### What to Annotate:
- **Quality feedback**: "This response was unhelpful"
- **Context notes**: "User was confused here" 
- **Improvement ideas**: "Should mention pricing"
- **Issues found**: "Factual error about dates"
- **Positive feedback**: "Perfect response!"

### Annotation Display:
- Annotations appear **next to messages** in the traces view
- **Hover** to see full annotation content
- **Click** to edit or add more details
- **Color coding** shows different annotation types

### Team Collaboration:
- **@mention** team members in annotations
- **Link** to external resources or tickets
- **Tag** annotations with categories
- **Track** who made what annotations
`
      );

    case "queues":
      return (
        intro +
        `
## 🗂️ Annotation Queues

Queues help organize review work and distribute it among team members:

### Creating Queues:
1. **Go to Annotations page** in LangWatch
2. **Click the + button** to create new queue
3. **Add queue details**:
   - Name (e.g., "Customer Support Review")
   - Description ("Review support interactions")
   - Team members who can access it
4. **Save** the queue

### Adding to Queues:
1. **Find a message** that needs review
2. **Click "Add to Queue"** button
3. **Select target queue** or team member
4. **Add context note** if needed
5. **Message is queued** for review

### Working Through Queues:
1. **Go to Annotations page**
2. **Click on your queue**
3. **Review each message** one by one
4. **Add annotations** as needed
5. **Click "Done"** to mark complete
6. **Move to next item**

### Queue Management:
- **Track progress**: See how many items remain
- **Assign work**: Distribute among team members  
- **Set priorities**: Important items first
- **Bulk operations**: Process multiple items
`
      );

    case "scoring":
      return (
        intro +
        `
## 🎯 Annotation Scoring

Create custom scoring systems for consistent evaluation:

### Setting Up Scores:
1. **Go to Settings page** in LangWatch
2. **Navigate to "Annotation Scoring"**
3. **Create new score types**:

### Score Types:
- **Checkbox**: Multiple selectable options
  - Example: ["Helpful", "Accurate", "Clear", "Complete"]
- **Multiple Choice**: Single selection
  - Example: "Quality: Excellent | Good | Fair | Poor"

### Score Configuration:
\`\`\`
Score Name: "Response Quality"
Type: Multiple Choice
Options:
- Excellent (5 points)
- Good (4 points) 
- Fair (3 points)
- Poor (2 points)
- Terrible (1 point)
\`\`\`

### Using Scores:
1. **Create annotation** on any message
2. **Scoring options appear** below comment box
3. **Select appropriate scores**
4. **Add optional reason** for the score
5. **Save** annotation with scores

### Analytics:
- **Track score trends** over time
- **Filter by score ranges** 
- **Compare team member** scoring patterns
- **Export scoring data** for analysis
`
      );

    case "collaboration":
      return (
        intro +
        `
## 👥 Team Collaboration Features

LangWatch enables seamless collaboration between domain experts and developers:

### Team Workflows:
1. **Domain experts** review conversations and add annotations
2. **Developers** get notified of issues and feedback
3. **Product managers** track quality metrics and trends
4. **Everyone** can see full context and history

### Collaboration Tools:
- **@mentions**: Tag specific team members
- **Queue assignments**: Distribute work fairly
- **Score tracking**: Consistent evaluation standards
- **Comment threads**: Discuss specific issues
- **Notification system**: Stay updated on important changes

### Best Practices:
- **Regular review sessions**: Schedule weekly annotation reviews
- **Clear scoring criteria**: Define what each score means
- **Action items**: Link annotations to development tasks
- **Feedback loops**: Close the loop with developers

### Integration Tips:
- **Link to tickets**: Connect annotations to Jira/GitHub issues
- **Export data**: Use annotation data in reports
- **Automate alerts**: Set up notifications for low scores
- **Track improvements**: Monitor quality trends over time

### Team Roles:
- **Reviewers**: Add annotations and scores
- **Assignees**: Receive and act on feedback  
- **Admins**: Manage queues and scoring systems
- **Viewers**: Read-only access to annotations
`
      );

    default:
      return (
        intro +
        `
## 📝 Complete Annotation System

LangWatch provides a comprehensive annotation and collaboration platform:

### 🎯 Core Features:
1. **Annotations**: Add comments and context to any message
2. **Queues**: Organize review work and distribute among team
3. **Scoring**: Create custom evaluation criteria
4. **Collaboration**: Enable seamless team workflows

### 🚀 Quick Start:
1. **Click any message** in your traces
2. **Add annotation** with comments
3. **Create queue** for team review  
4. **Set up scoring** in settings
5. **Invite team members** to collaborate

### 💡 Use Cases:
- **Quality assurance**: Review AI responses for accuracy
- **Customer feedback**: Annotate support interactions
- **Product improvement**: Track common issues and requests
- **Training data**: Create labeled datasets
- **Compliance**: Document review and approval processes

### 📊 Benefits:
- **Improved quality**: Systematic review and feedback
- **Team alignment**: Shared understanding of quality standards
- **Data insights**: Quantitative analysis of performance
- **Faster iteration**: Direct feedback to development team
- **Compliance**: Audit trail of reviews and decisions

For specific features, run:
- \`get_annotation_guide annotations\` - Basic annotation creation
- \`get_annotation_guide queues\` - Queue management
- \`get_annotation_guide scoring\` - Custom scoring systems  
- \`get_annotation_guide collaboration\` - Team workflows
`
      );
  }
}

function getFrameworkSpecificGuide(
  language: string,
  framework: string
): string {
  // Framework-specific integration guides could be added here
  // For now, we'll return a placeholder
  return `\n### ${framework} Integration\n\nSpecific integration guide for ${framework} with ${language} coming soon!\nFor now, follow the basic setup above and adapt to your ${framework} application structure.\n`;
}
