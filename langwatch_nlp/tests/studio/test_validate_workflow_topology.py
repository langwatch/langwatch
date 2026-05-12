"""Topology checks for `validate_workflow` — covers #3198.

The validator must surface a `ClientReadableValueError` with an actionable
message when the workflow has no End node, when the End node has no inbound
edges, or when other required scaffolding is missing. The downstream
`/execute_sync` handler turns those into HTTP 400s.
"""

import pytest

from langwatch_nlp.studio.execute.execute_flow import validate_workflow
from langwatch_nlp.studio.types.dsl import (
    Edge,
    End,
    EndNode,
    Entry,
    EntryNode,
    Field,
    FieldType,
    NodeDataset,
    Workflow,
    WorkflowState,
)
from langwatch_nlp.studio.utils import ClientReadableValueError


def _entry_node(node_id: str = "entry") -> EntryNode:
    return EntryNode(
        id=node_id,
        type="entry",
        data=Entry(
            name="Entry",
            inputs=None,
            outputs=[
                Field(identifier="question", type=FieldType.str, value=None, optional=None),
            ],
            train_size=0.5,
            test_size=0.5,
            seed=42,
            dataset=NodeDataset(name="Inline", inline=None),
        ),
    )


def _end_node(node_id: str = "end") -> EndNode:
    return EndNode(
        id=node_id,
        type="end",
        data=End(
            name="End",
            inputs=[
                Field(identifier="answer", type=FieldType.str, value=None, optional=None),
            ],
        ),
    )


def _make_workflow(*, nodes, edges) -> Workflow:
    return Workflow(
        api_key="",
        workflow_id="topology-test",
        spec_version="1.4",
        name="Topology Test",
        icon="🧪",
        description="Topology validation fixture",
        version="1.0",
        nodes=nodes,
        edges=edges,
        state=WorkflowState(),
        template_adapter="default",
    )


def test_workflow_missing_end_node_raises_client_readable_value_error():
    """Issue #3198 — no End node must surface a 400-ready message."""
    workflow = _make_workflow(nodes=[_entry_node()], edges=[])

    with pytest.raises(ClientReadableValueError) as excinfo:
        validate_workflow(workflow)

    assert "End node is missing" in str(excinfo.value)
    assert "End node" in str(excinfo.value)


def test_workflow_with_end_but_no_inbound_edges_raises_client_readable_value_error():
    """Issue #3198 — End node present but not wired surfaces a distinct message."""
    workflow = _make_workflow(
        nodes=[_entry_node(), _end_node()],
        edges=[],
    )

    with pytest.raises(ClientReadableValueError) as excinfo:
        validate_workflow(workflow)

    assert "End node 'end' has no wired inputs" in str(excinfo.value)


def test_workflow_with_wired_end_passes():
    """Happy path: entry -> end wired correctly passes validation."""
    workflow = _make_workflow(
        nodes=[_entry_node(), _end_node()],
        edges=[
            Edge(
                id="entry-end-answer",
                source="entry",
                sourceHandle="outputs.question",
                target="end",
                targetHandle="inputs.answer",
                type="default",
            )
        ],
    )

    # Should not raise.
    validate_workflow(workflow)
