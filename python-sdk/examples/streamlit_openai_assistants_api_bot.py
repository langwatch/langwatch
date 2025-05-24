from dotenv import load_dotenv

load_dotenv()

from typing import Optional
import streamlit as st
from openai import OpenAI
import langwatch
from langwatch.tracer import ContextSpan

client = OpenAI()

assistant = client.beta.assistants.create(
    name="Math Tutor",
    instructions="You are a personal math tutor. Write and run code to answer math questions.",
    tools=[{"type": "code_interpreter"}],
    model="gpt-4o-mini",
)

thread = client.beta.threads.create()


@langwatch.span(capture_output=False)
def pipeline(message: str):
    langwatch.get_current_trace().autotrack_openai_calls(client)
    langwatch.get_current_trace().update(
        metadata={"labels": ["openai", "assistants_api"], "thread_id": thread.id}
    )

    client.beta.threads.messages.create(
        thread_id=thread.id,
        role="user",
        content=message,
    )

    llm_span: Optional[ContextSpan] = None
    step_span: Optional[ContextSpan] = None

    with client.beta.threads.runs.stream(
        thread_id=thread.id,
        assistant_id=assistant.id,
        instructions="Please address the user as Jane Doe. The user has a premium account.",
    ) as stream:
        for event in stream:
            if event.event == "thread.run.created":
                llm_span = langwatch.get_current_span().span(
                    type="llm", input=event.data.instructions, model=event.data.model
                )

            elif event.event == "thread.run.completed":
                if llm_span:
                    usage = event.data.usage
                    completion_tokens = usage.completion_tokens if usage else None
                    prompt_tokens = usage.prompt_tokens if usage else None
                    llm_span.end(
                        metrics={
                            "completion_tokens": completion_tokens,
                            "prompt_tokens": prompt_tokens,
                        }
                    )
                    llm_span = None

            elif event.event == "thread.run.step.created":
                if llm_span:
                    step_span = llm_span.span(
                        type="tool" if event.data.type == "tool_calls" else "span",
                        name=event.data.step_details.type,
                    )

            elif event.event == "thread.run.step.delta":
                if step_span:
                    if (
                        event.data.delta.step_details
                        and event.data.delta.step_details.type == "tool_calls"
                        and event.data.delta.step_details.tool_calls
                        and len(event.data.delta.step_details.tool_calls) > 0
                    ):
                        tool_call = event.data.delta.step_details.tool_calls[0]
                        if (
                            tool_call.type == "code_interpreter"
                            and tool_call.code_interpreter
                        ):
                            step_span.update(
                                name=tool_call.type,
                                input=(step_span.input or "") + (tool_call.code_interpreter.input or ""),  # type: ignore
                                output=(step_span.output or []) + (tool_call.code_interpreter.outputs or []),  # type: ignore
                            )
                        # Add other tool calls here

            elif event.event == "thread.run.step.completed":
                if step_span:
                    step_span.end()
                    step_span = None

            elif event.data.object == "thread.message.delta" and event.data.delta.content:  # type: ignore
                text = event.data.delta.content[0].text.value or ""  # type: ignore

                if llm_span:
                    llm_span.update(output=(llm_span.output or "") + text)  # type: ignore

                if step_span:
                    step_span.update(output=(step_span.output or "") + text)  # type: ignore

                yield text

            else:
                pass


@langwatch.trace()
def process_message():
    message = st.session_state.prompt
    with st.chat_message("user"):
        st.markdown(message)

    with st.chat_message("assistant"):
        message_placeholder = st.empty()

        message_placeholder.write_stream(pipeline(message))


prompt = st.chat_input(
    "Ask your question here: ", on_submit=process_message, key="prompt"
)
