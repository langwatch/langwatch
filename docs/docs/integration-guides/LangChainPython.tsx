import { RenderCode } from "./utils/RenderCode";

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
        code={`export LANGWATCH_API_KEY='${apiKey ?? "your_api_key_here"}'`}
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
with langwatch.langchain.LangChainTracer(user_id="user-123", thread_id="thread-456") as langWatchCallback:
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
      <p>
        It's optional but highly recommended to pass the <code>user_id</code> if
        you want to leverage user-specific analytics and the{" "}
        <code>thread_id</code> to group related traces together. Read more about
        those and other concepts{" "}
        <a href="https://docs.langwatch.ai/docs/concepts" target="_blank">
          here
        </a>
        .
      </p>
    </div>
  );
};
