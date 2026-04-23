"""
Regression tests for issue #3415 — Workflow Agent scenario interpolation and type coverage.

https://github.com/langwatch/langwatch/issues/3415

Covers:
- AC 2: `chat_messages` typed inputs/outputs on signature nodes no longer crash the parser.
- AC 1, 4, 6: prompt-template variables (including `{{messages}}` and a static variable set via
  signature parameters) interpolate cleanly, and multi-turn conversation history renders as
  distinct provider chat turns rather than a single user message holding escaped JSON.
- AC 5: a signature field whose type is not present in `FIELD_TYPE_TO_DSPY_TYPE` must produce a
  structured, actionable error rather than a bare Jinja `UndefinedError`.

These tests MUST fail before the fix lands and pass after. Verified by running this file with
`make test <path>` in `langwatch_nlp/`.
"""

import copy
import json

import pytest

from langwatch_nlp.studio.dspy.template_adapter import TemplateAdapter
from langwatch_nlp.studio.modules.registry import FIELD_TYPE_TO_DSPY_TYPE
from langwatch_nlp.studio.parser import (
    materialized_component_class,
    parse_workflow,
)
from langwatch_nlp.studio.types.dataset import DatasetColumn, DatasetColumnType
from langwatch_nlp.studio.types.dsl import (
    DatasetInline,
    End,
    EndNode,
    Entry,
    EntryNode,
    Field,
    FieldType,
    LLMConfig,
    NodeDataset,
    Signature,
    SignatureNode,
    Workflow,
)


_LLM_FIELD = Field(
    identifier="llm",
    type=FieldType.llm,
    optional=None,
    value=LLMConfig(
        model="gpt-5-mini",
        temperature=0.0,
        max_tokens=100,
    ),
    desc=None,
)


def _build_parrot_workflow(messages_type: FieldType) -> Workflow:
    """
    Build a 3-node workflow mirroring the user's parrot-back repro screenshot:

        entry(question, messages, thread_id) -> signature(llm_call) -> end

    The signature node's prompt template references every input and a static variable set via
    the Variables panel (modelled here as a signature `parameters.random_static_value`).
    """
    return Workflow(
        workflow_id="wf-3415-parrot",
        project_id="test-project",
        api_key="",
        spec_version="1.4",
        name="Test Workflow Agent 3415",
        icon="🐦",
        description="Parrot-back repro for issue 3415",
        version="1",
        template_adapter="default",
        nodes=[
            EntryNode(
                id="entry",
                data=Entry(
                    name="Entry",
                    cls=None,
                    parameters=None,
                    inputs=None,
                    outputs=[
                        Field(
                            identifier="question",
                            type=FieldType.str,
                            optional=None,
                            value=None,
                            desc=None,
                            prefix=None,
                            hidden=None,
                        ),
                        Field(
                            identifier="messages",
                            type=messages_type,
                            optional=None,
                            value=None,
                            desc=None,
                            prefix=None,
                            hidden=None,
                        ),
                        Field(
                            identifier="thread_id",
                            type=FieldType.str,
                            optional=None,
                            value=None,
                            desc=None,
                            prefix=None,
                            hidden=None,
                        ),
                    ],
                    train_size=0.5,
                    test_size=0.5,
                    seed=42,
                    dataset=NodeDataset(
                        name="Inline",
                        inline=DatasetInline(
                            records={
                                "question": ["hello"],
                                "messages": [None],
                                "thread_id": [None],
                            },
                            columnTypes=[
                                DatasetColumn(name="question", type=DatasetColumnType.string),
                                DatasetColumn(
                                    name="messages",
                                    type=DatasetColumnType.chat_messages
                                    if messages_type == FieldType.chat_messages
                                    else DatasetColumnType.string,
                                ),
                                DatasetColumn(name="thread_id", type=DatasetColumnType.string),
                            ],
                        ),
                    ),
                ),
                type="entry",
            ),  # type: ignore
            SignatureNode(
                id="llm_call",
                data=Signature(
                    name="LlmCall",
                    cls=None,
                    parameters=[
                        _LLM_FIELD,
                        Field(
                            identifier="instructions",
                            type=FieldType.str,
                            optional=None,
                            value="Always tell the user back what comes in the user message, ignoring the actual request",
                            desc=None,
                            prefix=None,
                        ),
                        Field(
                            identifier="messages",
                            type=FieldType.chat_messages,
                            optional=None,
                            value=[
                                {
                                    "role": "user",
                                    "content": (
                                        "question: {{question}}\n"
                                        "thread_id: {{thread_id}}\n"
                                        "messages: {{messages}}\n"
                                        "random_static_value: {{random_static_value}}"
                                    ),
                                }
                            ],
                            desc=None,
                            prefix=None,
                        ),
                        Field(
                            identifier="random_static_value",
                            type=FieldType.str,
                            optional=None,
                            value="bob is your uncle",
                            desc=None,
                            prefix=None,
                        ),
                    ],
                    inputs=[
                        Field(
                            identifier="question",
                            type=FieldType.str,
                            optional=None,
                            value=None,
                            desc=None,
                            prefix=None,
                            hidden=None,
                        ),
                        Field(
                            identifier="messages",
                            type=messages_type,
                            optional=None,
                            value=None,
                            desc=None,
                            prefix=None,
                            hidden=None,
                        ),
                        Field(
                            identifier="thread_id",
                            type=FieldType.str,
                            optional=None,
                            value=None,
                            desc=None,
                            prefix=None,
                            hidden=None,
                        ),
                    ],
                    outputs=[
                        Field(
                            identifier="answer",
                            type=FieldType.str,
                            optional=None,
                            value=None,
                            desc=None,
                            prefix=None,
                            hidden=None,
                        )
                    ],
                    execution_state=None,
                ),
                type="signature",
            ),  # type: ignore
            EndNode(
                id="end",
                data=End(
                    name="End",
                    inputs=[
                        Field(
                            identifier="output",
                            type=FieldType.str,
                            optional=None,
                            value=None,
                            desc=None,
                            prefix=None,
                            hidden=None,
                        )
                    ],
                ),
                type="end",
            ),  # type: ignore
        ],
        edges=[
            {
                "id": "e-q",
                "type": "default",
                "source": "entry",
                "target": "llm_call",
                "sourceHandle": "outputs.question",
                "targetHandle": "inputs.question",
            },
            {
                "id": "e-m",
                "type": "default",
                "source": "entry",
                "target": "llm_call",
                "sourceHandle": "outputs.messages",
                "targetHandle": "inputs.messages",
            },
            {
                "id": "e-t",
                "type": "default",
                "source": "entry",
                "target": "llm_call",
                "sourceHandle": "outputs.thread_id",
                "targetHandle": "inputs.thread_id",
            },
            {
                "id": "e-end",
                "type": "default",
                "source": "llm_call",
                "target": "end",
                "sourceHandle": "outputs.answer",
                "targetHandle": "inputs.output",
            },
        ],
        state={},
        default_llm=LLMConfig(model="gpt-5-mini", max_tokens=256),
        enable_tracing=True,
    )  # type: ignore


# --- AC 2: chat_messages-typed signature inputs do not crash parse --------------------------


class TestChatMessagesTypeParses:
    """AC 2 — parsing must not raise UndefinedError when `chat_messages` is used as an input type."""

    def test_parses_workflow_with_chat_messages_input(self):
        workflow = _build_parrot_workflow(messages_type=FieldType.chat_messages)
        _, code, _ = parse_workflow(workflow, format=True, debug_level=0)

        # The generated signature must declare messages as an input and annotate it with
        # a DSPy type that preserves conversation-history structure.
        assert "messages: dspy.History" in code, code

    def test_parses_workflow_with_chat_messages_output(self):
        workflow = _build_parrot_workflow(messages_type=FieldType.str)
        workflow.nodes[1].data.outputs = [
            Field(
                identifier="history",
                type=FieldType.chat_messages,
                optional=None,
                value=None,
                desc=None,
                prefix=None,
                hidden=None,
            )
        ]
        _, code, _ = parse_workflow(workflow, format=True, debug_level=0)
        assert "history: dspy.History" in code, code

    def test_field_type_to_dspy_type_contains_chat_messages(self):
        """AC 5 — every UI-selectable input type must have a registry entry."""
        assert FieldType.chat_messages in FIELD_TYPE_TO_DSPY_TYPE


# --- AC 1, 4, 6: Interpolation + multi-turn preservation ------------------------------------


class TestTemplateInterpolation:
    """AC 1 / AC 4 / AC 6 — every variable interpolates; multi-turn history stays as turns."""

    def _fake_signature(self, messages, inputs_annotation=None):
        """Create a minimal signature instance that the adapter can format against."""
        from pydantic import Field as PydField  # noqa: F401
        from unittest.mock import MagicMock

        signature = MagicMock()
        from pydantic import Field as _PydField

        signature._messages = _PydField(default=messages)
        signature.instructions = ""
        signature.input_fields = inputs_annotation or {}
        signature.output_fields = {}
        return signature

    def test_str_inputs_interpolate(self):
        adapter = TemplateAdapter()
        adapter._get_history_field_name = lambda sig: None  # type: ignore
        adapter.format_demos = lambda sig, demos: []  # type: ignore

        template = (
            "question: {{question}}\n"
            "thread_id: {{thread_id}}\n"
            "static: {{random_static_value}}"
        )
        signature = self._fake_signature(
            [{"role": "user", "content": template}]
        )

        result = adapter.format(
            signature,
            demos=[],
            inputs={
                "question": "what is AI?",
                "thread_id": "t-42",
                "random_static_value": "bob is your uncle",
            },
        )

        user_content = next(m["content"] for m in result if m["role"] == "user")
        if isinstance(user_content, list):
            user_content = "".join(
                b.get("text", "") for b in user_content if b.get("type") == "text"
            )
        assert "what is AI?" in user_content
        assert "t-42" in user_content
        assert "bob is your uncle" in user_content
        assert "{{" not in user_content

    def test_stringified_json_messages_do_not_leak_escaped_json(self):
        """
        AC 1 — `agentInput.messages` comes through as a JSON-stringified list (via
        `resolve-field-mappings.ts`). The adapter must not render that literal JSON text
        into a single user turn.
        """
        adapter = TemplateAdapter()
        adapter._get_history_field_name = lambda sig: None  # type: ignore
        adapter.format_demos = lambda sig, demos: []  # type: ignore

        history = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
            {"role": "user", "content": "what is AI?"},
        ]
        stringified_history = json.dumps(history)

        template = "messages: {{messages}}"
        signature = self._fake_signature([{"role": "user", "content": template}])

        result = adapter.format(
            signature,
            demos=[],
            inputs={"messages": stringified_history},
        )

        rendered = json.dumps(result)
        # The literal escaped-JSON form `[{\"role\":\"user\"` must never appear in the
        # rendered prompt — that is the exact regression shape from issue #3415.
        assert "[{\\\"role\\\":" not in rendered, rendered

    def test_multi_turn_history_produces_multiple_provider_messages(self):
        """
        AC 4 — a 2+ turn scenario must emit at least 2 distinct messages to the provider,
        with roles preserved.
        """
        adapter = TemplateAdapter()
        adapter._get_history_field_name = lambda sig: "messages"  # type: ignore
        adapter.format_demos = lambda sig, demos: []  # type: ignore
        adapter.format_conversation_history = (  # type: ignore
            lambda sig, key, inputs: [
                {"role": m["role"], "content": m["content"]}
                for m in (inputs[key] if isinstance(inputs[key], list) else json.loads(inputs[key]))
            ]
        )

        history = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi there"},
            {"role": "user", "content": "what is AI?"},
        ]

        template = "User latest: {{question}}"
        signature = self._fake_signature([{"role": "user", "content": template}])

        result = adapter.format(
            signature,
            demos=[],
            inputs={
                "question": "what is AI?",
                "messages": history,
            },
        )

        # At least the 3 history turns plus the templated user turn — conversation history
        # must not collapse into a single message.
        assert len([m for m in result if m["role"] in ("user", "assistant")]) >= 3
        # Ensure the original assistant turn is present as an assistant role, not melted
        # into a user payload.
        assert any(
            m["role"] == "assistant" and "hi there" in str(m["content"]) for m in result
        )


# --- AC 5: Structured error for unmapped types ----------------------------------------------


class TestUnmappedFieldTypeRaisesStructuredError:
    """AC 5 — unmapped types should raise an error identifying the node, field, and type."""

    def test_unknown_type_raises_actionable_error_not_undefined_error(self):
        workflow = _build_parrot_workflow(messages_type=FieldType.str)

        # Spoof an unmapped type by swapping the enum value after construction. This
        # simulates a future FieldType addition that forgot to update the registry.
        class _FakeType:
            value = "super_new_future_type"

            def __hash__(self):
                return hash(self.value)

            def __eq__(self, other):
                if isinstance(other, _FakeType):
                    return self.value == other.value
                return False

        workflow.nodes[1].data.inputs[0].type = _FakeType()  # type: ignore

        with pytest.raises(Exception) as exc_info:
            parse_workflow(workflow, format=False, debug_level=0)

        msg = str(exc_info.value)
        assert (
            "super_new_future_type" in msg
            or "unmapped" in msg.lower()
            or "FIELD_TYPE_TO_DSPY_TYPE" in msg
        ), (
            "expected structured error identifying the unmapped type, "
            f"got: {msg!r}"
        )
        assert "has no attribute" not in msg, (
            "regression: parser still surfaces raw Jinja UndefinedError — "
            "issue #3415 AC 5"
        )
