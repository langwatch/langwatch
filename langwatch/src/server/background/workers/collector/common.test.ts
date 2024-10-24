import { describe, it, expect } from "vitest";
import {
  organizeSpansIntoTree,
  flattenSpanTree,
  getFirstInputAsText,
  getLastOutputAsText,
} from "./common"; // replace with your actual module path
import type { BaseSpan } from "../../../tracer/types";
import { elasticSearchSpanToSpan } from "../../../tracer/utils";

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

  it.only("extracts right input and output 3", () => {
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
});
