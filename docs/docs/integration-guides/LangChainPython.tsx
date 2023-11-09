import { RenderCode } from "./utils/RenderCode";

export const LangChainPython = ({ apiKey }: { apiKey?: string }) => {
  return (
    <div>
      <h3>Prerequisites:</h3>
      <ul>
        <li>
          Install the <code>langwatch</code> library via pip.
        </li>
        <li>
          Obtain your <code>LANGWATCH_API_KEY</code> from the LangWatch
          dashboard.
        </li>
      </ul>
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
        code={`import langwatch
from langchain.llms import ChatOpenAI
from langchain.prompts import ChatPromptTemplate

# Create your LangChain
model = ChatOpenAI()
prompt = ChatPromptTemplate.from_template("tell me a joke about {topic}")
chain = prompt | model

# Use the tracer context manager
with langwatch.langchain.LangChainTracer(user_id="user-123", thread_id="thread-456") as tracer:
    # Invoke LangChain with LangWatch callbacks
    result = chain.invoke(
        {"topic": "bears"},
        config={"callbacks": [tracer]}
    )
`}
        language="python"
      />
      <p>
        Each step in LangChain (<code>chain</code>) that invokes an LLM call
        will be traced as an individual span within a trace.
      </p>
      <p>
        For both integrations, it's crucial to pass the <code>user_id</code> if
        you want to leverage user-specific analytics and the{" "}
        <code>thread_id</code> to group related traces together.
      </p>
      <p>
        After following the above guides, your interactions with LLMs should now
        be captured by LangWatch. Once integrated, you can visit your LangWatch
        dashboard to view and analyze the traces collected from your
        applications.
      </p>
    </div>
  );
};
