import { MetadataFootnote } from "./utils/MetadataFootnote";
import { RenderCode } from "./utils/RenderCode";
import { langwatchEndpointEnv } from "./utils/langwatchEndpointEnv";

export const LangChainPython = ({ apiKey }: { apiKey?: string }) => {
  return (
    <div>
      <h3>Installation:</h3>
      <RenderCode code={`pip install langwatch`} language="bash" />
      <h3>Configuration:</h3>
      <p>
        Ensure the <code>LANGWATCH_API_KEY</code> environment variable is set:
      </p>
      <RenderCode
        code={`${langwatchEndpointEnv()}export LANGWATCH_API_KEY='${apiKey ?? "your_api_key_here"}'`}
        language="bash"
      />
      <h3>Usage:</h3>
      <p>
        Wrap your LangChain interactions with <code>LangChainTracer</code>.
      </p>
      <RenderCode
        code={`import langwatch.langchain
from langchain.llms import ChatOpenAI
from langchain.prompts import ChatPromptTemplate

# Create your LangChain
model = ChatOpenAI()
prompt = ChatPromptTemplate.from_template("tell me a joke about {topic}")
chain = prompt | model

# Use the tracer context manager
with langwatch.langchain.LangChainTracer(
  metadata={
    "user_id": "optional-user-123",
    "thread_id": "optional-thread-456",
  }
) as langWatchCallback:
    # Invoke LangChain with LangWatch callbacks
    result = chain.invoke(
        {"topic": "bears"},
        config={"callbacks": [langWatchCallback]}
    )
`}
        language="python"
      />
      <p>
        Each step in LangChain (<code>chain</code>) that invokes an LLM call
        will be traced as an individual span within a trace.
      </p>
      <MetadataFootnote />
    </div>
  );
};
