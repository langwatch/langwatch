import { describe, it, expect } from "vitest";
import {
  organizeSpansIntoTree,
  flattenSpanTree,
  getFirstInputAsText,
  getLastOutputAsText,
} from "./common"; // replace with your actual module path
import type { BaseSpan } from "../../../tracer/types";
import { transformElasticSearchSpanToSpan } from "../../../elasticsearch/transformers";

const elasticSearchSpanToSpan = transformElasticSearchSpanToSpan(
  {
    canSeeCapturedInput: true,
    canSeeCapturedOutput: true,
    canSeeCosts: true,
  },
  new Set()
);
describe("Span organizing and flattening tests", () => {
  const commonSpanProps = {
    type: "span" as BaseSpan["type"],
    trace_id: "trace_foo_bar",
    input: { type: "text", value: "random input" } as BaseSpan["input"],
    output: { type: "text", value: "random output" } as BaseSpan["output"],
  };

  const spans: BaseSpan[] = [
    // Top level spans
    {
      ...commonSpanProps,
      span_id: "1",
      name: "topmost span",
      parent_id: null,
      timestamps: { started_at: 100, finished_at: 500 },
      input: { type: "text", value: "topmost input" },
      params: {
        http: {
          method: "GET",
          target: "/ws/socket.io",
          status_code: 404,
        },
      },
    },
    {
      ...commonSpanProps,
      span_id: "2",
      parent_id: null,
      timestamps: { started_at: 200, finished_at: 600 },
      output: { type: "text", value: "bottommost output" },
    },

    // Children of span 1
    {
      ...commonSpanProps,
      span_id: "1-2",
      parent_id: "1",
      timestamps: { started_at: 300, finished_at: 700 },
    },
    {
      ...commonSpanProps,
      span_id: "1-1",
      parent_id: "1",
      timestamps: { started_at: 150, finished_at: 450 },
    },

    // Children of span 2
    {
      ...commonSpanProps,
      span_id: "2-1",
      parent_id: "2",
      timestamps: { started_at: 250, finished_at: 550 },
    },

    // Child of span 1-2 (nested child)
    {
      ...commonSpanProps,
      span_id: "1-2-1",
      parent_id: "1-2",
      timestamps: { started_at: 350, finished_at: 375 },
    },
  ];

  it("should organize spans into a parent-child hierarchy", () => {
    const organized = organizeSpansIntoTree(spans);
    expect(organized.length).toBe(2); // Two top level spans
    expect(organized[0]?.span_id).toBe("1");
    expect(organized[1]?.span_id).toBe("2");
    expect(organized[0]?.children.length).toBe(2); // Two children for span 1
    expect(organized[0]?.children[0]?.span_id).toBe("1-1");
    expect(organized[0]?.children[1]?.span_id).toBe("1-2");
    expect(organized[0]?.children[1]?.children.length).toBe(1); // One nested child
    expect(organized[0]?.children[1]?.children[0]?.span_id).toBe("1-2-1");
  });

  it("should flatten spans in finishing order inside-out", () => {
    const organized = organizeSpansIntoTree(spans);
    const flattened = flattenSpanTree(organized, "inside-out");
    expect(flattened.length).toBe(6);
    expect(flattened[0]?.span_id).toBe("1-2-1"); // Deepest child of the topmost span with the last started_at
    expect(flattened[5]?.span_id).toBe("2"); // Last span should be the topmost parent with the last started_at
  });

  it("should flatten spans in finishing order outside-in", () => {
    const organized = organizeSpansIntoTree(spans);
    const flattened = flattenSpanTree(organized, "outside-in");
    expect(flattened.length).toBe(6);
    expect(flattened[0]?.span_id).toBe("1"); // Topmost span with the first started_at
    expect(flattened[5]?.span_id).toBe("2-1"); // Deepest child of the last topmost span with the last started_at
  });

  it("should get the very first input as text", () => {
    const input = getFirstInputAsText(spans.sort(() => 0.5 - Math.random()));
    expect(input).toBe("topmost input");
  });

  it.skip("should get the very last output as text", () => {
    const output = getLastOutputAsText(spans.sort(() => 0.5 - Math.random()));
    expect(output).toBe("bottommost output");
  });

  it("uses http method and target as input if there are no inputs, for opentelemetry http cases", () => {
    const input = getFirstInputAsText(
      spans.map((span) => ({ ...span, input: undefined }))
    );
    expect(input).toBe("GET /ws/socket.io");
  });

  it("uses span name as input if there are no inputs, for non-http opentelemetry cases", () => {
    const input = getFirstInputAsText(
      spans.map((span) => ({ ...span, input: undefined, params: undefined }))
    );
    expect(input).toBe("topmost span");
  });

  it("uses http status code as output if there are no outputs, for opentelemetry http cases", () => {
    const output = getLastOutputAsText(
      spans.map((span) => ({ ...span, output: undefined }))
    );
    expect(output).toBe("404");
  });

  it("extracts right input and output", () => {
    const spans = [
      {
        output: {
          type: "json",
          value:
            '{"outputs":[],"kwargs":{"tags":["map:key:agent_scratchpad"]}}',
        },
        input: {
          type: "json",
          value:
            '{"inputs":{"input":"hello","chat_history":["content=\'Who recently worked on this product?\'","content=\'The most recent work order for the installed product was WO-00000009, scheduled for September 30, 2024, at 02:00 PM PDT. The technician assigned to this repair job is aiTech1. The work order is currently open.\'","content=\'Was it a maintenance or repair job?\'","content=\'The most recent work order, WO-00000009, for the installed product was a repair job.\'","content=\'When was the product installed?\'","content=\'The installed product was installed on November 25, 2013.\'"],"intermediate_steps":[]},"tags":["map:key:agent_scratchpad"],"metadata":[],"kwargs":{"run_type":null,"name":"RunnableLambda"}}',
        },
        trace_id: "8329df5ccdf925ff01aea731f77f3f79",
        span_id: "8a176dad6a6d3597",
        project_id: "project_T-5q2thwVWpClIX9tKEuB",
        parent_id: "789d492a34c99cfb",
        timestamps: {
          finished_at: 1727717804066,
          updated_at: 1727717804160,
          started_at: 1727717804062,
          inserted_at: 1727717804160,
        },
        name: "RunnableLambda.task",
        type: "task",
        params: {
          scope: {
            name: "opentelemetry.instrumentation.langchain",
            version: "0.30.1",
          },
          traceloop: {
            workflow: {
              name: "AgentExecutor",
            },
            entity: {
              path: "RunnableSequence.RunnableAssign<agent_scratchpad>.RunnableParallel<agent_scratchpad>",
              name: "RunnableLambda",
            },
          },
          _keys: [
            "traceloop.workflow.name",
            "traceloop.entity.path",
            "traceloop.entity.name",
            "scope.name",
            "scope.version",
          ],
        },
      },
      {
        output: {
          type: "json",
          value: '{"outputs":{"agent_scratchpad":[]},"kwargs":{"tags":[]}}',
        },
        input: {
          type: "json",
          value:
            '{"inputs":{"input":"hello","chat_history":["content=\'Who recently worked on this product?\'","content=\'The most recent work order for the installed product was WO-00000009, scheduled for September 30, 2024, at 02:00 PM PDT. The technician assigned to this repair job is aiTech1. The work order is currently open.\'","content=\'Was it a maintenance or repair job?\'","content=\'The most recent work order, WO-00000009, for the installed product was a repair job.\'","content=\'When was the product installed?\'","content=\'The installed product was installed on November 25, 2013.\'"],"intermediate_steps":[]},"tags":[],"metadata":[],"kwargs":{"name":"RunnableParallel<agent_scratchpad>"}}',
        },
        trace_id: "8329df5ccdf925ff01aea731f77f3f79",
        span_id: "789d492a34c99cfb",
        project_id: "project_T-5q2thwVWpClIX9tKEuB",
        parent_id: "87c28af6fe878acc",
        timestamps: {
          finished_at: 1727717804205,
          updated_at: 1727717804287,
          started_at: 1727717804059,
          inserted_at: 1727717804287,
        },
        name: "RunnableParallel<agent_scratchpad>.task",
        type: "task",
        params: {
          scope: {
            name: "opentelemetry.instrumentation.langchain",
            version: "0.30.1",
          },
          traceloop: {
            workflow: {
              name: "AgentExecutor",
            },
            entity: {
              path: "RunnableSequence.RunnableAssign<agent_scratchpad>",
              name: "RunnableParallel<agent_scratchpad>",
            },
          },
          _keys: [
            "traceloop.workflow.name",
            "traceloop.entity.path",
            "traceloop.entity.name",
            "scope.name",
            "scope.version",
          ],
        },
      },
      {
        output: {
          type: "json",
          value:
            '{"outputs":{"input":"hello","chat_history":["content=\'Who recently worked on this product?\'","content=\'The most recent work order for the installed product was WO-00000009, scheduled for September 30, 2024, at 02:00 PM PDT. The technician assigned to this repair job is aiTech1. The work order is currently open.\'","content=\'Was it a maintenance or repair job?\'","content=\'The most recent work order, WO-00000009, for the installed product was a repair job.\'","content=\'When was the product installed?\'","content=\'The installed product was installed on November 25, 2013.\'"],"intermediate_steps":[],"agent_scratchpad":[]},"kwargs":{"tags":["seq:step:1"]}}',
        },
        input: {
          type: "json",
          value:
            '{"inputs":{"input":"hello","chat_history":["content=\'Who recently worked on this product?\'","content=\'The most recent work order for the installed product was WO-00000009, scheduled for September 30, 2024, at 02:00 PM PDT. The technician assigned to this repair job is aiTech1. The work order is currently open.\'","content=\'Was it a maintenance or repair job?\'","content=\'The most recent work order, WO-00000009, for the installed product was a repair job.\'","content=\'When was the product installed?\'","content=\'The installed product was installed on November 25, 2013.\'"],"intermediate_steps":[]},"tags":["seq:step:1"],"metadata":[],"kwargs":{"run_type":null,"name":"RunnableAssign<agent_scratchpad>"}}',
        },
        trace_id: "8329df5ccdf925ff01aea731f77f3f79",
        span_id: "87c28af6fe878acc",
        project_id: "project_T-5q2thwVWpClIX9tKEuB",
        parent_id: "1c243b960789823c",
        timestamps: {
          finished_at: 1727717804345,
          updated_at: 1727717804423,
          started_at: 1727717804054,
          inserted_at: 1727717804423,
        },
        name: "RunnableAssign<agent_scratchpad>.task",
        type: "task",
        params: {
          scope: {
            name: "opentelemetry.instrumentation.langchain",
            version: "0.30.1",
          },
          traceloop: {
            workflow: {
              name: "AgentExecutor",
            },
            entity: {
              path: "RunnableSequence",
              name: "RunnableAssign<agent_scratchpad>",
            },
          },
          _keys: [
            "traceloop.workflow.name",
            "traceloop.entity.path",
            "traceloop.entity.name",
            "scope.name",
            "scope.version",
          ],
        },
      },
      {
        output: {
          type: "json",
          value:
            "{\"outputs\":\"messages=[SystemMessage(content=\\\"You are an AI system designed to select tools to answer user's questions. You must follow the following guidelines to answer user's question:\\\\n- if user's question is not related to greetings or the tools provided, but only if you cannot re-scope user's question against the installed product or work order context, just respond 'Sorry, I can't help with this.'\\\\n- you must not answer the user directly from any content of any past answers of the chat history, always invoking a tool to get an up-to-date answer\\\\n- plan your execution steps. Split a question into sub-questions if necessary based on the tools available and the data available to each tool.\\\\n- The 'question' parameter to each tool must be rephrased to include user's intent and the specific subject ID.\\\\n- make sure that the tool exists and verify that the question to the tool matches its input and output specification before calling it.\\\\n- invoke a matching tool to answer the question or its sub-questions in a chained fashion, avoiding asking the user or tool for any clarification or follow-up question\\\\n- under no circumstances should you attempt to call functions/tools that are not available to you. Any functions/tools you do call must have the name satisfy the following regex: ^[a-zA-Z0-9_-]+$\\\\n\\\\nA technician named ai admin is chatting with you. You should greeting the user nicely. You can tell the technician that you know his/her name. This technician was initially querying information about Installed Product of ID a0QD300000IUq1iMAD at the beginning of this conversation.\\\\nYou must:\\\\n- assume that pronouns or definite articles used by this technician can be understood by the tools provided. For instance, if the user asks 'Describe the problem in more detail', you should assume that the tools understand what problem the user is referring to\\\\n- keep tracking the record ID of work order or installed product, as the ID can change based on the conversation and user's previous questions. When the conversation starts, assume that the identifier/context is the record ID a0QD300000IUq1iMAD for a Installed Product\\\\n- assume that the installed product identifier should change if the work order identifier changes, or vice versa.\\\\n- when the context is not explicitly mentioned in user's question, you must default it to either the installed product or work order reachable through your use of the tools provided.\\\\n- you should expect that the user may ask questions without explicitly mentioning the work order or installed product. Examples of such questions are: 'What is most common type of job', 'list all work orders', or 'list all open work orders' etc. For questions like this, you should always automatically relate or scope user's questions to the current installed product or work order context for an answer.\\\\n- ensure that the record IDs are of the correct format. An ID has a regex pattern of '[A-Za-z0-9]' with fixed 18 characters. You should not mistake a record ID for a Name, or vice versa.\\\\n- invoke 'get_service_history_for_installed_product_id' tool when:\\\\n  - the user asks you to tell about an installed product or asset/equipment, either by name or by ID.\\\\n  - the user asks about an asset/equipment or installed product within the context of a work order, calling 'get_installed_product_id_for_work_order_id' tool to get the installed product ID from the work order\\\\n\\\"), HumanMessage(content='Who recently worked on this product?'), AIMessage(content='The most recent work order for the installed product was WO-00000009, scheduled for September 30, 2024, at 02:00 PM PDT. The technician assigned to this repair job is aiTech1. The work order is currently open.'), HumanMessage(content='Was it a maintenance or repair job?'), AIMessage(content='The most recent work order, WO-00000009, for the installed product was a repair job.'), HumanMessage(content='When was the product installed?'), AIMessage(content='The installed product was installed on November 25, 2013.'), HumanMessage(content='hello')]\",\"kwargs\":{\"tags\":[\"seq:step:2\"]}}",
        },
        input: {
          type: "json",
          value:
            '{"inputs":{"input":"hello","chat_history":["content=\'Who recently worked on this product?\'","content=\'The most recent work order for the installed product was WO-00000009, scheduled for September 30, 2024, at 02:00 PM PDT. The technician assigned to this repair job is aiTech1. The work order is currently open.\'","content=\'Was it a maintenance or repair job?\'","content=\'The most recent work order, WO-00000009, for the installed product was a repair job.\'","content=\'When was the product installed?\'","content=\'The installed product was installed on November 25, 2013.\'"],"intermediate_steps":[],"agent_scratchpad":[]},"tags":["seq:step:2"],"metadata":[],"kwargs":{"run_type":"prompt","name":"ChatPromptTemplate"}}',
        },
        trace_id: "8329df5ccdf925ff01aea731f77f3f79",
        span_id: "6013486f0d8ba4d7",
        project_id: "project_T-5q2thwVWpClIX9tKEuB",
        parent_id: "1c243b960789823c",
        timestamps: {
          finished_at: 1727717804477,
          updated_at: 1727717804557,
          started_at: 1727717804474,
          inserted_at: 1727717804557,
        },
        name: "ChatPromptTemplate.task",
        type: "task",
        params: {
          scope: {
            name: "opentelemetry.instrumentation.langchain",
            version: "0.30.1",
          },
          traceloop: {
            workflow: {
              name: "AgentExecutor",
            },
            entity: {
              path: "RunnableSequence",
              name: "ChatPromptTemplate",
            },
          },
          _keys: [
            "traceloop.workflow.name",
            "traceloop.entity.path",
            "traceloop.entity.name",
            "scope.name",
            "scope.version",
          ],
        },
      },
      {
        output: {
          type: "json",
          value:
            '{"outputs":"return_values={\'output\': \'Hello, ai admin! How can I assist you today?\'} log=\'Hello, ai admin! How can I assist you today?\'","kwargs":{"tags":["seq:step:4"]}}',
        },
        input: {
          type: "json",
          value:
            "{\"inputs\":\"content='Hello, ai admin! How can I assist you today?' response_metadata={'token_usage': {'completion_tokens': 13, 'prompt_tokens': 1296, 'total_tokens': 1309, 'completion_tokens_details': None}, 'model_name': 'gpt-4o-mini', 'system_fingerprint': 'fp_878413d04d', 'prompt_filter_results': [{'prompt_index': 0, 'content_filter_results': {}}], 'finish_reason': 'stop', 'logprobs': None, 'content_filter_results': {'hate': {'filtered': False, 'severity': 'safe'}, 'protected_material_code': {'filtered': False, 'detected': False}, 'protected_material_text': {'filtered': False, 'detected': False}, 'self_harm': {'filtered': False, 'severity': 'safe'}, 'sexual': {'filtered': False, 'severity': 'safe'}, 'violence': {'filtered': False, 'severity': 'safe'}}} id='run-2fa96f8a-6fd1-4649-aff6-83aefc9c644e-0' usage_metadata={'input_tokens': 1296, 'output_tokens': 13, 'total_tokens': 1309}\",\"tags\":[\"seq:step:4\"],\"metadata\":[],\"kwargs\":{\"run_type\":\"parser\",\"name\":\"OpenAIToolsAgentOutputParser\"}}",
        },
        trace_id: "8329df5ccdf925ff01aea731f77f3f79",
        span_id: "262966db1dea1496",
        project_id: "project_T-5q2thwVWpClIX9tKEuB",
        parent_id: "1c243b960789823c",
        timestamps: {
          finished_at: 1727717805090,
          updated_at: 1727717805189,
          started_at: 1727717805088,
          inserted_at: 1727717805189,
        },
        name: "OpenAIToolsAgentOutputParser.task",
        type: "task",
        params: {
          scope: {
            name: "opentelemetry.instrumentation.langchain",
            version: "0.30.1",
          },
          traceloop: {
            workflow: {
              name: "AgentExecutor",
            },
            entity: {
              path: "RunnableSequence",
              name: "OpenAIToolsAgentOutputParser",
            },
          },
          _keys: [
            "traceloop.workflow.name",
            "traceloop.entity.path",
            "traceloop.entity.name",
            "scope.name",
            "scope.version",
          ],
        },
      },
      {
        output: {
          type: "chat_messages",
          value:
            '[{"role":"assistant","content":"Hello, ai admin! How can I assist you today?"}]',
        },
        input: {
          type: "chat_messages",
          value:
            '[{"role":"system","content":"You are an AI system designed to select tools to answer user\'s questions. You must follow the following guidelines to answer user\'s question:\\n- if user\'s question is not related to greetings or the tools provided, but only if you cannot re-scope user\'s question against the installed product or work order context, just respond \'Sorry, I can\'t help with this.\'\\n- you must not answer the user directly from any content of any past answers of the chat history, always invoking a tool to get an up-to-date answer\\n- plan your execution steps. Split a question into sub-questions if necessary based on the tools available and the data available to each tool.\\n- The \'question\' parameter to each tool must be rephrased to include user\'s intent and the specific subject ID.\\n- make sure that the tool exists and verify that the question to the tool matches its input and output specification before calling it.\\n- invoke a matching tool to answer the question or its sub-questions in a chained fashion, avoiding asking the user or tool for any clarification or follow-up question\\n- under no circumstances should you attempt to call functions/tools that are not available to you. Any functions/tools you do call must have the name satisfy the following regex: ^[a-zA-Z0-9_-]+$\\n\\nA technician named ai admin is chatting with you. You should greeting the user nicely. You can tell the technician that you know his/her name. This technician was initially querying information about Installed Product of ID a0QD300000IUq1iMAD at the beginning of this conversation.\\nYou must:\\n- assume that pronouns or definite articles used by this technician can be understood by the tools provided. For instance, if the user asks \'Describe the problem in more detail\', you should assume that the tools understand what problem the user is referring to\\n- keep tracking the record ID of work order or installed product, as the ID can change based on the conversation and user\'s previous questions. When the conversation starts, assume that the identifier/context is the record ID a0QD300000IUq1iMAD for a Installed Product\\n- assume that the installed product identifier should change if the work order identifier changes, or vice versa.\\n- when the context is not explicitly mentioned in user\'s question, you must default it to either the installed product or work order reachable through your use of the tools provided.\\n- you should expect that the user may ask questions without explicitly mentioning the work order or installed product. Examples of such questions are: \'What is most common type of job\', \'list all work orders\', or \'list all open work orders\' etc. For questions like this, you should always automatically relate or scope user\'s questions to the current installed product or work order context for an answer.\\n- ensure that the record IDs are of the correct format. An ID has a regex pattern of \'[A-Za-z0-9]\' with fixed 18 characters. You should not mistake a record ID for a Name, or vice versa.\\n- invoke \'get_service_history_for_installed_product_id\' tool when:\\n  - the user asks you to tell about an installed product or asset/equipment, either by name or by ID.\\n  - the user asks about an asset/equipment or installed product within the context of a work order, calling \'get_installed_product_id_for_work_order_id\' tool to get the installed product ID from the work order\\n"},{"role":"user","content":"Who recently worked on this product?"},{"role":"assistant","content":"The most recent work order for the installed product was WO-00000009, scheduled for September 30, 2024, at 02:00 PM PDT. The technician assigned to this repair job is aiTech1. The work order is currently open."},{"role":"user","content":"Was it a maintenance or repair job?"},{"role":"assistant","content":"The most recent work order, WO-00000009, for the installed product was a repair job."},{"role":"user","content":"When was the product installed?"},{"role":"assistant","content":"The installed product was installed on November 25, 2013."},{"role":"user","content":"hello"}]',
        },
        trace_id: "8329df5ccdf925ff01aea731f77f3f79",
        span_id: "39ae0bdaf3cd8ec2",
        project_id: "project_T-5q2thwVWpClIX9tKEuB",
        parent_id: "1c243b960789823c",
        timestamps: {
          finished_at: 1727717804958,
          updated_at: 1727717805054,
          started_at: 1727717804607,
          inserted_at: 1727717805054,
        },
        name: "AzureChatOpenAI.chat",
        model: "gpt-4o-mini",
        metrics: {
          tokens_estimated: true,
          completion_tokens: 12,
          prompt_tokens: 807,
          cost: 0.00012825,
        },
        type: "llm",
        params: {
          gen_ai: {
            system: "Langchain",
            usage: {
              completion_tokens: 13,
              prompt_tokens: 1296,
            },
          },
          scope: {
            name: "opentelemetry.instrumentation.langchain",
            version: "0.30.1",
          },
          llm: {
            usage: {
              total_tokens: 1309,
            },
          },
          traceloop: {
            workflow: {
              name: "AgentExecutor",
            },
            entity: {
              path: "RunnableSequence",
            },
          },
          _keys: [
            "traceloop.workflow.name",
            "traceloop.entity.path",
            "gen_ai.system",
            "gen_ai.usage.prompt_tokens",
            "gen_ai.usage.completion_tokens",
            "llm.usage.total_tokens",
            "scope.name",
            "scope.version",
          ],
        },
      },
      {
        output: {
          type: "json",
          value:
            '{"outputs":{"output":"Hello, ai admin! How can I assist you today?"},"kwargs":{"tags":[]}}',
        },
        input: {
          type: "json",
          value:
            '{"inputs":{"input":"hello","chat_history":["content=\'Who recently worked on this product?\'","content=\'The most recent work order for the installed product was WO-00000009, scheduled for September 30, 2024, at 02:00 PM PDT. The technician assigned to this repair job is aiTech1. The work order is currently open.\'","content=\'Was it a maintenance or repair job?\'","content=\'The most recent work order, WO-00000009, for the installed product was a repair job.\'","content=\'When was the product installed?\'","content=\'The installed product was installed on November 25, 2013.\'"]},"tags":[],"metadata":{"aig_trace_id":"8329df5ccdf925ff01aea731f77f3f79"},"kwargs":{"name":"AgentExecutor"}}',
        },
        trace_id: "8329df5ccdf925ff01aea731f77f3f79",
        span_id: "f1c738df898612f4",
        project_id: "project_T-5q2thwVWpClIX9tKEuB",
        parent_id: "b59271e41758903b",
        timestamps: {
          finished_at: 1727717805357,
          updated_at: 1727717805438,
          started_at: 1727717804035,
          inserted_at: 1727717805438,
        },
        name: "AgentExecutor.workflow",
        type: "workflow",
        params: {
          scope: {
            name: "opentelemetry.instrumentation.langchain",
            version: "0.30.1",
          },
          traceloop: {
            workflow: {
              name: "AgentExecutor",
            },
            entity: {
              name: "AgentExecutor",
            },
          },
          _keys: [
            "traceloop.workflow.name",
            "traceloop.entity.name",
            "scope.name",
            "scope.version",
          ],
        },
      },
      {
        output: {
          type: "json",
          value:
            '{"outputs":"return_values={\'output\': \'Hello, ai admin! How can I assist you today?\'} log=\'Hello, ai admin! How can I assist you today?\'","kwargs":{"tags":[]}}',
        },
        input: {
          type: "json",
          value:
            '{"inputs":{"input":"hello","chat_history":["content=\'Who recently worked on this product?\'","content=\'The most recent work order for the installed product was WO-00000009, scheduled for September 30, 2024, at 02:00 PM PDT. The technician assigned to this repair job is aiTech1. The work order is currently open.\'","content=\'Was it a maintenance or repair job?\'","content=\'The most recent work order, WO-00000009, for the installed product was a repair job.\'","content=\'When was the product installed?\'","content=\'The installed product was installed on November 25, 2013.\'"],"intermediate_steps":[]},"tags":[],"metadata":[],"kwargs":{"name":"RunnableSequence"}}',
        },
        trace_id: "8329df5ccdf925ff01aea731f77f3f79",
        span_id: "1c243b960789823c",
        project_id: "project_T-5q2thwVWpClIX9tKEuB",
        parent_id: "f1c738df898612f4",
        timestamps: {
          finished_at: 1727717805226,
          updated_at: 1727717805312,
          started_at: 1727717804046,
          inserted_at: 1727717805312,
        },
        name: "RunnableSequence.task",
        type: "task",
        params: {
          scope: {
            name: "opentelemetry.instrumentation.langchain",
            version: "0.30.1",
          },
          traceloop: {
            workflow: {
              name: "AgentExecutor",
            },
            entity: {
              name: "RunnableSequence",
            },
          },
          _keys: [
            "traceloop.workflow.name",
            "traceloop.entity.name",
            "scope.name",
            "scope.version",
          ],
        },
      },
    ];

    const input = getFirstInputAsText(
      spans.map(elasticSearchSpanToSpan as any)
    );
    const output = getLastOutputAsText(
      spans.map(elasticSearchSpanToSpan as any)
    );

    expect(input).toEqual("hello");
    expect(output).toEqual("Hello, ai admin! How can I assist you today?");
  });

  it("extracts right input and output 2", () => {
    const spans = [
      {
        trace_id: "09a3a62d643781f64cd571bd76b888c5",
        span_id: "657afafdcdcbb644",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        parent_id: "2b3dee21797241ef",
        timestamps: {
          finished_at: 1727729278649,
          updated_at: 1727729283447,
          started_at: 1727729278647,
          inserted_at: 1727729283447,
        },
        name: "ChatPromptTemplate.task",
        type: "task",
        params: {
          scope: {
            name: "opentelemetry.instrumentation.langchain",
            version: "0.31.3",
          },
          traceloop: {
            workflow: {
              name: "RunnableSequence",
            },
            entity: {
              name: "ChatPromptTemplate",
            },
          },
          _keys: [
            "traceloop.workflow.name",
            "traceloop.entity.name",
            "scope.name",
            "scope.version",
          ],
        },
        input: {
          type: "json",
          value: {
            inputs: {
              question: "1",
            },
            tags: ["seq:step:1"],
            kwargs: {
              run_type: "prompt",
              name: "ChatPromptTemplate",
            },
          },
        },
        output: {
          type: "json",
          value: {
            outputs:
              "messages=[SystemMessage(content='You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.'), HumanMessage(content='1')]",
            kwargs: {
              tags: ["seq:step:1"],
            },
          },
        },
      },
      {
        trace_id: "09a3a62d643781f64cd571bd76b888c5",
        span_id: "aa4d63840a8cb65a",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        parent_id: "2b3dee21797241ef",
        timestamps: {
          finished_at: 1727729283960,
          updated_at: 1727729284068,
          started_at: 1727729283730,
          inserted_at: 1727729284068,
        },
        name: "StrOutputParser.task",
        type: "task",
        params: {
          scope: {
            name: "opentelemetry.instrumentation.langchain",
            version: "0.31.3",
          },
          traceloop: {
            workflow: {
              name: "RunnableSequence",
            },
            entity: {
              name: "StrOutputParser",
            },
          },
          _keys: [
            "traceloop.workflow.name",
            "traceloop.entity.name",
            "scope.name",
            "scope.version",
          ],
        },
        input: {
          type: "json",
          value: {
            inputs: {
              input: "",
            },
            tags: ["seq:step:3"],
            kwargs: {
              run_type: "parser",
              name: "StrOutputParser",
            },
          },
        },
        output: {
          type: "json",
          value: {
            outputs: "Hey there! How can I help you today? 🌟",
            kwargs: {
              tags: ["seq:step:3"],
              inputs:
                "content='Hey there! How can I help you today? 🌟' response_metadata={'finish_reason': 'stop', 'model_name': 'gpt-3.5-turbo-0125'} id='run-f96bfd8d-10d7-48a3-8715-edd2171e7dbe'",
            },
          },
        },
      },
      {
        trace_id: "09a3a62d643781f64cd571bd76b888c5",
        span_id: "2b3dee21797241ef",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        timestamps: {
          finished_at: 1727729284030,
          updated_at: 1727729284139,
          started_at: 1727729278644,
          inserted_at: 1727729284139,
        },
        name: "RunnableSequence.workflow",
        type: "workflow",
        params: {
          scope: {
            name: "opentelemetry.instrumentation.langchain",
            version: "0.31.3",
          },
          traceloop: {
            workflow: {
              name: "RunnableSequence",
            },
            entity: {
              name: "RunnableSequence",
            },
          },
          _keys: [
            "traceloop.workflow.name",
            "traceloop.entity.name",
            "scope.name",
            "scope.version",
          ],
        },
        input: {
          type: "json",
          value: {
            inputs: {
              input: "",
            },
            tags: [],
            kwargs: {
              run_type: null,
              name: "RunnableSequence",
            },
          },
        },
        output: {
          type: "json",
          value: {
            outputs: "Hey there! How can I help you today? 🌟",
            kwargs: {
              tags: [],
              inputs: {
                question: "1",
              },
            },
          },
        },
      },
      {
        trace_id: "09a3a62d643781f64cd571bd76b888c5",
        span_id: "30bef24cd9932bf1",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        parent_id: "2b3dee21797241ef",
        timestamps: {
          finished_at: 1727729283878,
          updated_at: 1727729286000,
          started_at: 1727729283177,
          inserted_at: 1727729286000,
        },
        name: "ChatOpenAI.chat",
        model: "gpt-3.5-turbo",
        metrics: {
          tokens_estimated: true,
          completion_tokens: 13,
          cost: 0.000026,
        },
        type: "llm",
        params: {
          gen_ai: {
            request: {
              temperature: 0.7,
            },
            system: "Langchain",
            prompt: [
              {
                role: "system",
                content:
                  "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
              },
              {
                role: "user",
                content: 1,
              },
            ],
          },
          scope: {
            name: "opentelemetry.instrumentation.langchain",
            version: "0.31.3",
          },
          traceloop: {
            workflow: {
              name: "RunnableSequence",
            },
          },
          _keys: [
            "traceloop.workflow.name",
            "gen_ai.system",
            "gen_ai.request.temperature",
            "gen_ai.prompt",
            "scope.name",
            "scope.version",
          ],
        },
        input: null,
        output: {
          type: "chat_messages",
          value: [
            {
              role: "assistant",
              content: "Hey there! How can I help you today? 🌟",
            },
          ],
        },
      },
    ];

    const input = getFirstInputAsText(
      spans.map(elasticSearchSpanToSpan as any)
    );
    const output = getLastOutputAsText(
      spans.map(elasticSearchSpanToSpan as any)
    );

    expect(input).toEqual("1");
    expect(output).toEqual("Hey there! How can I help you today? 🌟");
  });

  it("extracts right input and output 3", () => {
    const spans = [
      {
        output: {
          type: "json",
          value: '{"messages":[{"role":"user","content":"hey there"}]}',
        },
        input: {
          type: "json",
          value: '{"messages":[{"role":"user","content":"hey there"}]}',
        },
        trace_id: "trace_980Pq_-8ri9C4eMv7hduy",
        span_id: "span_e9a58fd1-2747-44ab-824a-b4a6c52b8edd",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        parent_id: "span_8e5c4b6c-fb09-4be0-8567-463c1b31c1de",
        timestamps: {
          finished_at: 1728648730545,
          updated_at: 1728648735155,
          started_at: 1728648730542,
          inserted_at: 1728648735155,
        },
        name: "__start__",
        metrics: null,
        type: "chain",
        error: null,
      },
      {
        trace_id: "trace_980Pq_-8ri9C4eMv7hduy",
        span_id: "span_c0d02d15-ed6b-480b-8e4e-b95aa31b25b9",
        timestamps: {
          finished_at: 1728648731709,
          updated_at: 1728648735155,
          started_at: 1728648730587,
          inserted_at: 1728648735155,
        },
        type: "llm",
        error: null,
        params: {
          stream: true,
          temperature: 0.7,
          tools: [
            {
              function: {
                name: "langwatch_search",
                description:
                  "Search for information about LangWatch. For any questions about LangWatch, use this tool if you didn't already",
                parameters: {
                  type: "object",
                  properties: {
                    query: {
                      description: "query to look up in retriever",
                      type: "string",
                    },
                  },
                  required: ["query"],
                },
              },
              type: "function",
            },
          ],
          n: 1,
          _keys: ["n", "stream", "temperature", "tools"],
        },
        output: {
          type: "chat_messages",
          value:
            '[{"role":"assistant","content":"Hello! How can I assist you today?"}]',
        },
        input: {
          type: "chat_messages",
          value: '[{"role":"user","content":"hey there"}]',
        },
        project_id: "KAXYxPR8MUgTcP8CF193y",
        parent_id: "span_6e85deb1-5174-4320-a027-34af93c47e41",
        name: null,
        model: "openai/gpt-3.5-turbo",
        metrics: {
          tokens_estimated: true,
          completion_tokens: 9,
          prompt_tokens: 2,
          cost: 0.000021000000000000002,
        },
      },
      {
        output: {
          type: "json",
          value:
            '{"messages":[{"role":"assistant","content":"Hello! How can I assist you today?"}]}',
        },
        input: {
          type: "json",
          value:
            '{"messages":[{"role":"assistant","content":"Hello! How can I assist you today?"}]}',
        },
        trace_id: "trace_980Pq_-8ri9C4eMv7hduy",
        span_id: "span_c06010fe-1188-4826-8c7d-ad5f94b2d05d",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        parent_id: "span_6e85deb1-5174-4320-a027-34af93c47e41",
        timestamps: {
          finished_at: 1728648731744,
          updated_at: 1728648735155,
          started_at: 1728648731741,
          inserted_at: 1728648735155,
        },
        name: "_write",
        metrics: null,
        type: "chain",
        error: null,
      },
      {
        output: {
          type: "text",
          value: '"__end__"',
        },
        input: {
          type: "json",
          value:
            '{"messages":[{"role":"user","content":"hey there"},{"role":"assistant","content":"Hello! How can I assist you today?"}]}',
        },
        trace_id: "trace_980Pq_-8ri9C4eMv7hduy",
        span_id: "span_c93729d0-3900-4836-a862-32e523b06c63",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        parent_id: "span_6e85deb1-5174-4320-a027-34af93c47e41",
        timestamps: {
          finished_at: 1728648731771,
          updated_at: 1728648735155,
          started_at: 1728648731769,
          inserted_at: 1728648735155,
        },
        name: "should_continue",
        metrics: null,
        type: "chain",
        error: null,
      },
      {
        output: {
          type: "json",
          value:
            '{"messages":[{"role":"assistant","content":"Hello! How can I assist you today?"}]}',
        },
        input: {
          type: "json",
          value: '{"messages":[{"role":"user","content":"hey there"}]}',
        },
        trace_id: "trace_980Pq_-8ri9C4eMv7hduy",
        span_id: "span_6e85deb1-5174-4320-a027-34af93c47e41",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        parent_id: "span_8e5c4b6c-fb09-4be0-8567-463c1b31c1de",
        timestamps: {
          finished_at: 1728648731783,
          updated_at: 1728648735155,
          started_at: 1728648730583,
          inserted_at: 1728648735155,
        },
        name: "agent",
        metrics: null,
        type: "chain",
        error: null,
      },
      {
        output: {
          type: "json",
          value:
            '{"messages":[{"role":"user","content":"hey there"},{"role":"assistant","content":"Hello! How can I assist you today?"}]}',
        },
        input: {
          type: "json",
          value: '{"messages":[{"role":"user","content":"hey there"}]}',
        },
        trace_id: "trace_980Pq_-8ri9C4eMv7hduy",
        span_id: "span_8e5c4b6c-fb09-4be0-8567-463c1b31c1de",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        parent_id: "span_fnKgUACWwNNA3DogXr6Np",
        timestamps: {
          finished_at: 1728648731795,
          updated_at: 1728648735155,
          started_at: 1728648730538,
          inserted_at: 1728648735155,
        },
        name: "LangGraph",
        metrics: null,
        type: "chain",
        error: null,
      },
      {
        output: {
          type: "json",
          value: "null",
        },
        input: {
          type: "json",
          value:
            '{"message":{"id":"fdd1fce6-051f-4305-a1b1-04addc4b301e","threadId":"d25109d5-0daa-4133-a3fe-afc4cc879676","parentId":null,"createdAt":"2024-10-11T12:12:10.517501Z","start":"2024-10-11T12:12:10.517501Z","end":"2024-10-11T12:12:10.517501Z","output":"hey there","name":"admin","type":"user_message","language":null,"streaming":false,"isError":false,"waitForAnswer":false,"indent":null,"metadata":{},"tags":null}}',
        },
        trace_id: "trace_980Pq_-8ri9C4eMv7hduy",
        span_id: "span_fnKgUACWwNNA3DogXr6Np",
        project_id: "KAXYxPR8MUgTcP8CF193y",
        parent_id: null,
        timestamps: {
          finished_at: 1728648731809,
          updated_at: 1728648735155,
          started_at: 1728648730523,
          inserted_at: 1728648735155,
        },
        name: "main",
        metrics: null,
        type: "span",
        error: null,
      },
    ];

    const input = getFirstInputAsText(
      spans.map(elasticSearchSpanToSpan as any)
    );
    const output = getLastOutputAsText(
      spans.map(elasticSearchSpanToSpan as any)
    );

    expect(input).toEqual("hey there");
    expect(output).toEqual("Hello! How can I assist you today?");
  });

  it("extracts right input and output 4", () => {
    const spans = [
      {
        type: "component",
        name: "Chat Input",
        span_id: "ChatInput-qxSub-oQbUKf",
        parent_id: "29bf1758-3355-4d55-bd2a-1d0090b64bb3-JgyLTz",
        trace_id: "56392841-f392-4c5a-84b0-934119d162d2",
        input: {
          type: "json",
          value:
            '{"input_value":"","sender_name":"User","session_id":"","background_color":"","chat_icon":"","text_color":"","code":"from langflow.base.data.utils import IMG_FILE_TYPES, TEXT_FILE_TYPES\\nfrom langflow.base.io.chat import ChatComponent\\nfrom langflow.inputs import BoolInput\\nfrom langflow.io import DropdownInput, FileInput, MessageTextInput, MultilineInput, Output\\nfrom langflow.schema.message import Message\\nfrom langflow.utils.constants import MESSAGE_SENDER_AI, MESSAGE_SENDER_NAME_USER, MESSAGE_SENDER_USER\\n\\n\\nclass ChatInput(ChatComponent):\\n    display_name = \\"Chat Input\\"\\n    description = \\"Get chat inputs from the Playground.\\"\\n    icon = \\"MessagesSquare\\"\\n    name = \\"ChatInput\\"\\n\\n    inputs = [\\n        MultilineInput(\\n            name=\\"input_value\\",\\n            display_name=\\"Text\\",\\n            value=\\"\\",\\n            info=\\"Message to be passed as input.\\",\\n        ),\\n        BoolInput(\\n            name=\\"should_store_message\\",\\n            display_name=\\"Store Messages\\",\\n            info=\\"Store the message in the history.\\",\\n            value=True,\\n            advanced=True,\\n        ),\\n        DropdownInput(\\n            name=\\"sender\\",\\n            display_name=\\"Sender Type\\",\\n            options=[MESSAGE_SENDER_AI, MESSAGE_SENDER_USER],\\n            value=MESSAGE_SENDER_USER,\\n            info=\\"Type of sender.\\",\\n            advanced=True,\\n        ),\\n        MessageTextInput(\\n            name=\\"sender_name\\",\\n            display_name=\\"Sender Name\\",\\n            info=\\"Name of the sender.\\",\\n            value=MESSAGE_SENDER_NAME_USER,\\n            advanced=True,\\n        ),\\n        MessageTextInput(\\n            name=\\"session_id\\",\\n            display_name=\\"Session ID\\",\\n            info=\\"The session ID of the chat. If empty, the current session ID parameter will be used.\\",\\n            advanced=True,\\n        ),\\n        FileInput(\\n            name=\\"files\\",\\n            display_name=\\"Files\\",\\n            file_types=TEXT_FILE_TYPES + IMG_FILE_TYPES,\\n            info=\\"Files to be sent with the message.\\",\\n            advanced=True,\\n            is_list=True,\\n        ),\\n        MessageTextInput(\\n            name=\\"background_color\\",\\n            display_name=\\"Background Color\\",\\n            info=\\"The background color of the icon.\\",\\n            advanced=True,\\n        ),\\n        MessageTextInput(\\n            name=\\"chat_icon\\",\\n            display_name=\\"Icon\\",\\n            info=\\"The icon of the message.\\",\\n            advanced=True,\\n        ),\\n        MessageTextInput(\\n            name=\\"text_color\\",\\n            display_name=\\"Text Color\\",\\n            info=\\"The text color of the name\\",\\n            advanced=True,\\n        ),\\n    ]\\n    outputs = [\\n        Output(display_name=\\"Message\\", name=\\"message\\", method=\\"message_response\\"),\\n    ]\\n\\n    def message_response(self) -> Message:\\n        _background_color = self.background_color\\n        _text_color = self.text_color\\n        _icon = self.chat_icon\\n        message = Message(\\n            text=self.input_value,\\n            sender=self.sender,\\n            sender_name=self.sender_name,\\n            session_id=self.session_id,\\n            files=self.files,\\n            properties={\\"background_color\\": _background_color, \\"text_color\\": _text_color, \\"icon\\": _icon},\\n        )\\n        if self.session_id and isinstance(message, Message) and self.should_store_message:\\n            stored_message = self.send_message(\\n                message,\\n            )\\n            self.message.value = stored_message\\n            message = stored_message\\n\\n        self.status = message\\n        return message\\n","files":[],"sender":"User","should_store_message":true}',
        },
        output: {
          type: "json",
          value: "{}",
        },
        error: null,
        timestamps: {
          started_at: 1731929544379,
          finished_at: 1731929544391,
          inserted_at: 1731929547127,
          updated_at: 1731929547127,
        },
        project_id: "KAXYxPR8MUgTcP8CF193y",
      },
      {
        type: "component",
        name: "Prompt",
        span_id: "Prompt-2dgC2-c4pMTK",
        parent_id: "29bf1758-3355-4d55-bd2a-1d0090b64bb3-JgyLTz",
        trace_id: "56392841-f392-4c5a-84b0-934119d162d2",
        input: {
          type: "json",
          value:
            '{"template":"","code":"from langflow.base.prompts.api_utils import process_prompt_template\\nfrom langflow.custom import Component\\nfrom langflow.inputs.inputs import DefaultPromptField\\nfrom langflow.io import Output, PromptInput\\nfrom langflow.schema.message import Message\\nfrom langflow.template.utils import update_template_values\\n\\n\\nclass PromptComponent(Component):\\n    display_name: str = \\"Prompt\\"\\n    description: str = \\"Create a prompt template with dynamic variables.\\"\\n    icon = \\"prompts\\"\\n    trace_type = \\"prompt\\"\\n    name = \\"Prompt\\"\\n\\n    inputs = [\\n        PromptInput(name=\\"template\\", display_name=\\"Template\\"),\\n    ]\\n\\n    outputs = [\\n        Output(display_name=\\"Prompt Message\\", name=\\"prompt\\", method=\\"build_prompt\\"),\\n    ]\\n\\n    async def build_prompt(self) -> Message:\\n        prompt = Message.from_template(**self._attributes)\\n        self.status = prompt.text\\n        return prompt\\n\\n    def _update_template(self, frontend_node: dict):\\n        prompt_template = frontend_node[\\"template\\"][\\"template\\"][\\"value\\"]\\n        custom_fields = frontend_node[\\"custom_fields\\"]\\n        frontend_node_template = frontend_node[\\"template\\"]\\n        _ = process_prompt_template(\\n            template=prompt_template,\\n            name=\\"template\\",\\n            custom_fields=custom_fields,\\n            frontend_node_template=frontend_node_template,\\n        )\\n        return frontend_node\\n\\n    def post_code_processing(self, new_frontend_node: dict, current_frontend_node: dict):\\n        \\"\\"\\"This function is called after the code validation is done.\\"\\"\\"\\n        frontend_node = super().post_code_processing(new_frontend_node, current_frontend_node)\\n        template = frontend_node[\\"template\\"][\\"template\\"][\\"value\\"]\\n        # Kept it duplicated for backwards compatibility\\n        _ = process_prompt_template(\\n            template=template,\\n            name=\\"template\\",\\n            custom_fields=frontend_node[\\"custom_fields\\"],\\n            frontend_node_template=frontend_node[\\"template\\"],\\n        )\\n        # Now that template is updated, we need to grab any values that were set in the current_frontend_node\\n        # and update the frontend_node with those values\\n        update_template_values(new_template=frontend_node, previous_template=current_frontend_node[\\"template\\"])\\n        return frontend_node\\n\\n    def _get_fallback_input(self, **kwargs):\\n        return DefaultPromptField(**kwargs)\\n"}',
        },
        output: {
          type: "json",
          value: "{}",
        },
        error: null,
        timestamps: {
          started_at: 1731929544404,
          finished_at: 1731929544410,
          inserted_at: 1731929547127,
          updated_at: 1731929547127,
        },
        project_id: "KAXYxPR8MUgTcP8CF193y",
      },
      {
        type: "llm",
        name: null,
        span_id: "span_a153a1c4-0d2a-4e2a-840a-44cc4a9ed5c3",
        parent_id: "OpenAIModel-ipoQP-9sthdR",
        trace_id: "56392841-f392-4c5a-84b0-934119d162d2",
        input: {
          type: "chat_messages",
          value:
            '[{"role":"system","content":"Answer the user as if you were a pirate."},{"role":"user","content":"Hello"}]',
        },
        output: {
          type: "chat_messages",
          value:
            '[{"role":"assistant","content":"Ahoy there, matey! What brings ye to these treacherous waters? Speak yer mind, and let\'s set sail on a grand adventure! Arrr! 🏴\u200d☠️"}]',
        },
        error: null,
        timestamps: {
          started_at: 1731929544436,
          finished_at: 1731929545629,
          inserted_at: 1731929547127,
          updated_at: 1731929547127,
        },
        model: "openai/gpt-4o-mini",
        params: {
          n: 1,
          seed: 1,
          temperature: 0.1,
          _keys: ["n", "seed", "temperature"],
        },
        metrics: {
          prompt_tokens: 22,
          completion_tokens: 41,
          cost: 0.000027899999999999997,
        },
        project_id: "KAXYxPR8MUgTcP8CF193y",
      },
      {
        type: "component",
        name: "OpenAI",
        span_id: "OpenAIModel-ipoQP-9sthdR",
        parent_id: "Prompt-2dgC2-c4pMTK",
        trace_id: "56392841-f392-4c5a-84b0-934119d162d2",
        input: {
          type: "json",
          value:
            '{"input_value":"","system_message":"","model_kwargs":{},"output_schema":{},"api_key":"*****","code":"import operator\\nfrom functools import reduce\\n\\nfrom langchain_openai import ChatOpenAI\\nfrom pydantic.v1 import SecretStr\\n\\nfrom langflow.base.models.model import LCModelComponent\\nfrom langflow.base.models.openai_constants import OPENAI_MODEL_NAMES\\nfrom langflow.field_typing import LanguageModel\\nfrom langflow.field_typing.range_spec import RangeSpec\\nfrom langflow.inputs import BoolInput, DictInput, DropdownInput, FloatInput, IntInput, SecretStrInput, StrInput\\nfrom langflow.inputs.inputs import HandleInput\\n\\n\\nclass OpenAIModelComponent(LCModelComponent):\\n    display_name = \\"OpenAI\\"\\n    description = \\"Generates text using OpenAI LLMs.\\"\\n    icon = \\"OpenAI\\"\\n    name = \\"OpenAIModel\\"\\n\\n    inputs = [\\n        *LCModelComponent._base_inputs,\\n        IntInput(\\n            name=\\"max_tokens\\",\\n            display_name=\\"Max Tokens\\",\\n            advanced=True,\\n            info=\\"The maximum number of tokens to generate. Set to 0 for unlimited tokens.\\",\\n            range_spec=RangeSpec(min=0, max=128000),\\n        ),\\n        DictInput(\\n            name=\\"model_kwargs\\",\\n            display_name=\\"Model Kwargs\\",\\n            advanced=True,\\n            info=\\"Additional keyword arguments to pass to the model.\\",\\n        ),\\n        BoolInput(\\n            name=\\"json_mode\\",\\n            display_name=\\"JSON Mode\\",\\n            advanced=True,\\n            info=\\"If True, it will output JSON regardless of passing a schema.\\",\\n        ),\\n        DictInput(\\n            name=\\"output_schema\\",\\n            is_list=True,\\n            display_name=\\"Schema\\",\\n            advanced=True,\\n            info=\\"The schema for the Output of the model. \\"\\n            \\"You must pass the word JSON in the prompt. \\"\\n            \\"If left blank, JSON mode will be disabled. [DEPRECATED]\\",\\n        ),\\n        DropdownInput(\\n            name=\\"model_name\\",\\n            display_name=\\"Model Name\\",\\n            advanced=False,\\n            options=OPENAI_MODEL_NAMES,\\n            value=OPENAI_MODEL_NAMES[0],\\n        ),\\n        StrInput(\\n            name=\\"openai_api_base\\",\\n            display_name=\\"OpenAI API Base\\",\\n            advanced=True,\\n            info=\\"The base URL of the OpenAI API. \\"\\n            \\"Defaults to https://api.openai.com/v1. \\"\\n            \\"You can change this to use other APIs like JinaChat, LocalAI and Prem.\\",\\n        ),\\n        SecretStrInput(\\n            name=\\"api_key\\",\\n            display_name=\\"OpenAI API Key\\",\\n            info=\\"The OpenAI API Key to use for the OpenAI model.\\",\\n            advanced=False,\\n            value=\\"OPENAI_API_KEY\\",\\n        ),\\n        FloatInput(name=\\"temperature\\", display_name=\\"Temperature\\", value=0.1),\\n        IntInput(\\n            name=\\"seed\\",\\n            display_name=\\"Seed\\",\\n            info=\\"The seed controls the reproducibility of the job.\\",\\n            advanced=True,\\n            value=1,\\n        ),\\n        HandleInput(\\n            name=\\"output_parser\\",\\n            display_name=\\"Output Parser\\",\\n            info=\\"The parser to use to parse the output of the model\\",\\n            advanced=True,\\n            input_types=[\\"OutputParser\\"],\\n        ),\\n    ]\\n\\n    def build_model(self) -> LanguageModel:  # type: ignore[type-var]\\n        # self.output_schema is a list of dictionaries\\n        # let\'s convert it to a dictionary\\n        output_schema_dict: dict[str, str] = reduce(operator.ior, self.output_schema or {}, {})\\n        openai_api_key = self.api_key\\n        temperature = self.temperature\\n        model_name: str = self.model_name\\n        max_tokens = self.max_tokens\\n        model_kwargs = self.model_kwargs or {}\\n        openai_api_base = self.openai_api_base or \\"https://api.openai.com/v1\\"\\n        json_mode = bool(output_schema_dict) or self.json_mode\\n        seed = self.seed\\n\\n        api_key = SecretStr(openai_api_key).get_secret_value() if openai_api_key else None\\n        output = ChatOpenAI(\\n            max_tokens=max_tokens or None,\\n            model_kwargs=model_kwargs,\\n            model=model_name,\\n            base_url=openai_api_base,\\n            api_key=api_key,\\n            temperature=temperature if temperature is not None else 0.1,\\n            seed=seed,\\n        )\\n        if json_mode:\\n            if output_schema_dict:\\n                output = output.with_structured_output(schema=output_schema_dict, method=\\"json_mode\\")\\n            else:\\n                output = output.bind(response_format={\\"type\\": \\"json_object\\"})\\n\\n        return output\\n\\n    def _get_exception_message(self, e: Exception):\\n        \\"\\"\\"Get a message from an OpenAI exception.\\n\\n        Args:\\n            e (Exception): The exception to get the message from.\\n\\n        Returns:\\n            str: The message from the exception.\\n        \\"\\"\\"\\n        try:\\n            from openai import BadRequestError\\n        except ImportError:\\n            return None\\n        if isinstance(e, BadRequestError):\\n            message = e.body.get(\\"message\\")\\n            if message:\\n                return message\\n        return None\\n","json_mode":false,"max_tokens":"","model_name":"gpt-4o-mini","openai_api_base":"","seed":1,"stream":false,"temperature":0.1,"output_parser":null}',
        },
        output: {
          type: "json",
          value: "{}",
        },
        error: null,
        timestamps: {
          started_at: 1731929544420,
          finished_at: 1731929545647,
          inserted_at: 1731929547127,
          updated_at: 1731929547127,
        },
        project_id: "KAXYxPR8MUgTcP8CF193y",
      },
      {
        type: "component",
        name: "Chat Output",
        span_id: "ChatOutput-T4qQU-nnAjrt",
        parent_id: "OpenAIModel-ipoQP-9sthdR",
        trace_id: "56392841-f392-4c5a-84b0-934119d162d2",
        input: {
          type: "json",
          value:
            '{"input_value":"","sender_name":"AI","session_id":"","data_template":"{text}","background_color":"","chat_icon":"","text_color":"","code":"from langflow.base.io.chat import ChatComponent\\nfrom langflow.inputs import BoolInput\\nfrom langflow.io import DropdownInput, MessageInput, MessageTextInput, Output\\nfrom langflow.schema.message import Message\\nfrom langflow.schema.properties import Source\\nfrom langflow.utils.constants import MESSAGE_SENDER_AI, MESSAGE_SENDER_NAME_AI, MESSAGE_SENDER_USER\\n\\n\\nclass ChatOutput(ChatComponent):\\n    display_name = \\"Chat Output\\"\\n    description = \\"Display a chat message in the Playground.\\"\\n    icon = \\"MessagesSquare\\"\\n    name = \\"ChatOutput\\"\\n\\n    inputs = [\\n        MessageInput(\\n            name=\\"input_value\\",\\n            display_name=\\"Text\\",\\n            info=\\"Message to be passed as output.\\",\\n        ),\\n        BoolInput(\\n            name=\\"should_store_message\\",\\n            display_name=\\"Store Messages\\",\\n            info=\\"Store the message in the history.\\",\\n            value=True,\\n            advanced=True,\\n        ),\\n        DropdownInput(\\n            name=\\"sender\\",\\n            display_name=\\"Sender Type\\",\\n            options=[MESSAGE_SENDER_AI, MESSAGE_SENDER_USER],\\n            value=MESSAGE_SENDER_AI,\\n            advanced=True,\\n            info=\\"Type of sender.\\",\\n        ),\\n        MessageTextInput(\\n            name=\\"sender_name\\",\\n            display_name=\\"Sender Name\\",\\n            info=\\"Name of the sender.\\",\\n            value=MESSAGE_SENDER_NAME_AI,\\n            advanced=True,\\n        ),\\n        MessageTextInput(\\n            name=\\"session_id\\",\\n            display_name=\\"Session ID\\",\\n            info=\\"The session ID of the chat. If empty, the current session ID parameter will be used.\\",\\n            advanced=True,\\n        ),\\n        MessageTextInput(\\n            name=\\"data_template\\",\\n            display_name=\\"Data Template\\",\\n            value=\\"{text}\\",\\n            advanced=True,\\n            info=\\"Template to convert Data to Text. If left empty, it will be dynamically set to the Data\'s text key.\\",\\n        ),\\n        MessageTextInput(\\n            name=\\"background_color\\",\\n            display_name=\\"Background Color\\",\\n            info=\\"The background color of the icon.\\",\\n            advanced=True,\\n        ),\\n        MessageTextInput(\\n            name=\\"chat_icon\\",\\n            display_name=\\"Icon\\",\\n            info=\\"The icon of the message.\\",\\n            advanced=True,\\n        ),\\n        MessageTextInput(\\n            name=\\"text_color\\",\\n            display_name=\\"Text Color\\",\\n            info=\\"The text color of the name\\",\\n            advanced=True,\\n        ),\\n    ]\\n    outputs = [\\n        Output(\\n            display_name=\\"Message\\",\\n            name=\\"message\\",\\n            method=\\"message_response\\",\\n        ),\\n    ]\\n\\n    def _build_source(self, _id: str | None, display_name: str | None, source: str | None) -> Source:\\n        source_dict = {}\\n        if _id:\\n            source_dict[\\"id\\"] = _id\\n        if display_name:\\n            source_dict[\\"display_name\\"] = display_name\\n        if source:\\n            source_dict[\\"source\\"] = source\\n        return Source(**source_dict)\\n\\n    def message_response(self) -> Message:\\n        _source, _icon, _display_name, _source_id = self.get_properties_from_source_component()\\n        _background_color = self.background_color\\n        _text_color = self.text_color\\n        if self.chat_icon:\\n            _icon = self.chat_icon\\n        message = self.input_value if isinstance(self.input_value, Message) else Message(text=self.input_value)\\n        message.sender = self.sender\\n        message.sender_name = self.sender_name\\n        message.session_id = self.session_id\\n        message.flow_id = self.graph.flow_id if hasattr(self, \\"graph\\") else None\\n        message.properties.source = self._build_source(_source_id, _display_name, _source)\\n        message.properties.icon = _icon\\n        message.properties.background_color = _background_color\\n        message.properties.text_color = _text_color\\n        if self.session_id and isinstance(message, Message) and self.should_store_message:\\n            stored_message = self.send_message(\\n                message,\\n            )\\n            self.message.value = stored_message\\n            message = stored_message\\n\\n        self.status = message\\n        return message\\n","sender":"Machine","should_store_message":true}',
        },
        output: {
          type: "json",
          value: "{}",
        },
        error: null,
        timestamps: {
          started_at: 1731929545660,
          finished_at: 1731929545673,
          inserted_at: 1731929547127,
          updated_at: 1731929547127,
        },
        project_id: "KAXYxPR8MUgTcP8CF193y",
      },
      {
        type: "component",
        name: "Custom Component",
        span_id: "CustomComponent-c4ebt-YCfXmU",
        parent_id: "ChatOutput-T4qQU-nnAjrt",
        trace_id: "56392841-f392-4c5a-84b0-934119d162d2",
        input: {
          type: "json",
          value:
            '{"input_value":"Hello, World!","code":"# from langflow.field_typing import Data\\nfrom langflow.custom import Component\\nfrom langflow.io import MessageTextInput, Output\\nfrom langflow.schema import Data\\n\\n\\nclass CustomComponent(Component):\\n    display_name = \\"Custom Component\\"\\n    description = \\"Use as a template to create your own component.\\"\\n    documentation: str = \\"http://docs.langflow.org/components/custom\\"\\n    icon = \\"code\\"\\n    name = \\"CustomComponent\\"\\n\\n    inputs = [\\n        MessageTextInput(\\n            name=\\"input_value\\",\\n            display_name=\\"Input Value\\",\\n            info=\\"This is a custom component Input\\",\\n            value=\\"Hello, World!\\",\\n            tool_mode=True,\\n        ),\\n    ]\\n\\n    outputs = [\\n        Output(display_name=\\"Output\\", name=\\"output\\", method=\\"build_output\\"),\\n    ]\\n\\n    def build_output(self) -> Data:\\n        data = Data(value=self.input_value)\\n        self.status = data\\n        return data\\n"}',
        },
        output: {
          type: "json",
          value: "{}",
        },
        error: null,
        timestamps: {
          started_at: 1731929545684,
          finished_at: 1731929545714,
          inserted_at: 1731929547127,
          updated_at: 1731929547127,
        },
        project_id: "KAXYxPR8MUgTcP8CF193y",
      },
      {
        type: "workflow",
        name: "None",
        span_id: "29bf1758-3355-4d55-bd2a-1d0090b64bb3-JgyLTz",
        parent_id: null,
        trace_id: "56392841-f392-4c5a-84b0-934119d162d2",
        input: {
          type: "json",
          value: "{}",
        },
        output: {
          type: "json",
          value: '{"Custom Component (CustomComponent-c4ebt)":{}}',
        },
        error: null,
        timestamps: {
          started_at: 1731929544371,
          finished_at: 1731929545743,
          inserted_at: 1731929547127,
          updated_at: 1731929547127,
        },
        project_id: "KAXYxPR8MUgTcP8CF193y",
      },
    ];

    const input = getFirstInputAsText(
      spans.map(elasticSearchSpanToSpan as any)
    );
    const output = getLastOutputAsText(
      spans.map(elasticSearchSpanToSpan as any)
    );

    // expect(input).toBe("Hello");
    expect(output).toBe(
      "Ahoy there, matey! What brings ye to these treacherous waters? Speak yer mind, and let's set sail on a grand adventure! Arrr! 🏴‍☠️"
    );
  });

  it("extracts text from chat_messages with nested content structure", () => {
    const spans = [
      {
        ...commonSpanProps,
        span_id: "1",
        name: "test span",
        parent_id: null,
        timestamps: { started_at: 100, finished_at: 500 },
        input: {
          type: "chat_messages",
          value: [
            {
              role: "user",
              content: [
                {
                  text: "ohai",
                },
              ],
            },
          ],
        },
      },
    ];

    const input = getFirstInputAsText(
      spans.map(elasticSearchSpanToSpan as any)
    );
    expect(input).toBe("ohai");
  });
});
