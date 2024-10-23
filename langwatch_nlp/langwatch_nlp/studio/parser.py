import json
from typing import Any, Dict, List, Optional
from langwatch_nlp.studio.dspy.predict_with_metadata import PredictWithMetadata
from langwatch_nlp.studio.dspy.retrieve import ContextsRetriever
from langwatch_nlp.studio.modules.evaluators.langwatch import LangWatchEvaluator
from langwatch_nlp.studio.modules.registry import EVALUATORS, RETRIEVERS
from langwatch_nlp.studio.types.dsl import (
    End,
    Evaluator,
    Field,
    FieldType,
    Node,
    Retriever,
    Signature,
    Workflow,
)
import dspy

from langwatch_nlp.studio.utils import (
    node_llm_config_to_dspy_lm,
    transpose_inline_dataset_to_object_list,
)


def parse_component(node: Node, workflow: Workflow) -> dspy.Module:
    match node.type:
        case "signature":
            return parse_signature(node.id, node.data, workflow)()
        case "retriever":
            return parse_retriever(node.id, node.data, workflow)
        case "evaluator":
            return parse_evaluator(node.data, workflow)
        case "end":
            return parse_end(node.data, workflow)
        case _:
            raise NotImplementedError(f"Unknown component type: {node.type}")


def parse_signature(
    node_id: str, component: Signature, workflow: Workflow
) -> type[dspy.Module]:
    class_name = component.name or "AnonymousSignature"

    # Create a dictionary to hold the class attributes
    class_dict = {}

    # Add input fields
    if component.inputs:
        for input_field in component.inputs:
            class_dict[input_field.identifier] = dspy.InputField()

    # Add output fields
    if component.outputs:
        for output_field in component.outputs:
            class_dict[output_field.identifier] = dspy.OutputField()

    # Add the docstring (prompt) if available
    if component.prompt:
        class_dict["__doc__"] = component.prompt

    # Create the class dynamically
    SignatureClass: type[dspy.Signature] = type(
        class_name + "Signature", (dspy.Signature,), class_dict
    )

    llm_config = component.llm if component.llm else workflow.default_llm
    lm = node_llm_config_to_dspy_lm(llm_config)

    dspy.settings.configure(experimental=True)

    def __init__(self, *args, **kwargs) -> None:
        PredictWithMetadata.__init__(self, SignatureClass)
        self.set_lm(lm=lm)
        self._node_id = node_id
        if component.demonstrations and component.demonstrations.inline:
            demos: List[Dict[str, Any]] = transpose_inline_dataset_to_object_list(
                component.demonstrations.inline
            )
            self.demos = demos
        else:
            self.demos = []

    def reset(self) -> None:
        PredictWithMetadata.reset(self)
        self.lm = lm

    ModuleClass: type[PredictWithMetadata] = type(
        class_name, (PredictWithMetadata,), {"__init__": __init__, "reset": reset}
    )

    return ModuleClass


def parse_evaluator(component: Evaluator, workflow: Workflow) -> dspy.Module:
    if not component.cls:
        raise ValueError("Evaluator class not specified")

    if component.cls == "LangWatchEvaluator":
        settings = parse_fields(component.parameters or [], autoparse=False)
        if not component.evaluator:
            raise ValueError("Evaluator not specified")
        return LangWatchEvaluator(
            api_key=workflow.api_key,
            evaluator=component.evaluator,
            name=component.name or "LangWatchEvaluator",
            settings=settings,
        )

    return EVALUATORS[component.cls]()


def parse_end(_component: End, _workflow: Workflow) -> dspy.Module:
    class EndNode(dspy.Module):
        def forward(self, **kwargs) -> Any:
            return kwargs

    return EndNode()


def parse_retriever(
    node_id: str, component: Retriever, workflow: Workflow
) -> dspy.Module:
    if not component.cls:
        raise ValueError("Retriever class not specified")

    kwargs = parse_fields(component.parameters or [])
    return ContextsRetriever(rm=RETRIEVERS[component.cls], **kwargs)


def parse_fields(fields: List[Field], autoparse=True) -> Dict[str, Any]:
    return {
        field.identifier: (
            autoparse_field_value(field, field.defaultValue)
            if autoparse
            else field.defaultValue
        )
        for field in fields
        if field.defaultValue
    }


def autoparse_field_value(field: Field, value: Optional[Any]) -> Optional[Any]:
    if type(value) == str and (
        value.startswith("{") or value.startswith("[") or value.startswith('"')
    ):
        try:
            value = json.loads(value)
        except ValueError:
            pass
    if value is None:
        return None

    if field.type == FieldType.int:
        return int(value)
    if field.type == FieldType.float:
        return float(value)
    if field.type == FieldType.bool:
        return bool(value)
    if field.type == FieldType.str:
        if type(value) == str:
            return value
        try:
            return json.dumps(value)
        except Exception:
            if isinstance(value, object):
                return repr(value)
            return str(value)
    if field.type == FieldType.list_str and not isinstance(value, list):
        return [
            autoparse_field_value(
                Field(identifier=field.identifier, type=FieldType.str), value
            )
        ]
    return value


def autoparse_fields(fields: List[Field], values: Dict[str, Any]) -> Dict[str, Any]:
    parsed_values = {}
    for field in fields:
        if not field.identifier in values:
            continue
        parsed_values[field.identifier] = autoparse_field_value(
            field, values[field.identifier]
        )
    return parsed_values
