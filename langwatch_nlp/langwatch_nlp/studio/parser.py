import json
import re
from typing import Any, Dict, List, Optional, Union, cast
from langwatch_nlp.studio.modules.evaluators.evaluator_wrapper import EvaluatorWrapper
from langwatch_nlp.studio.dspy.llm_node import LLMNode
from langwatch_nlp.studio.dspy.retrieve import ContextsRetriever
from langwatch_nlp.studio.modules.evaluators.langwatch import LangWatchEvaluator
from langwatch_nlp.studio.modules.registry import (
    EVALUATORS,
    PROMPTING_TECHNIQUES,
    RETRIEVERS,
    PromptingTechniqueTypes,
)
from langwatch_nlp.studio.types.dsl import (
    End,
    Evaluator,
    Field,
    FieldType,
    LLMConfig,
    Node,
    NodeDataset,
    NodeRef,
    CodeNode,
    PromptingTechnique,
    PromptingTechniqueNode,
    Retriever,
    Signature,
    Workflow,
    Code,
    Custom,
)
import dspy

import langwatch
import httpx


from langwatch_nlp.studio.utils import (
    node_llm_config_to_dspy_lm,
    transpose_inline_dataset_to_object_list,
)


def parse_component(node: Node, workflow: Workflow) -> dspy.Module:
    match node.type:
        case "signature":
            return parse_signature(node.id, node.data, workflow)
        case "code":
            return parse_code(node.id, node.data, workflow)
        case "prompting_technique":
            raise NotImplementedError("Prompting techniques cannot be parsed directly")
        case "retriever":
            return parse_retriever(node.id, node.data, workflow)
        case "evaluator":
            return parse_evaluator(node.data, workflow)
        case "end":
            return parse_end(node.data, workflow)
        case "custom":
            return parse_custom(node.data, workflow)
        case _:
            raise NotImplementedError(f"Unknown component type: {node.type}")


def apiCall(inputs, api_key, endpoint, workflow_id, version_id):
    if version_id:
        url = endpoint + "/api/workflows/" + workflow_id + "/" + version_id + "/run"
    else:
        url = endpoint + "/api/workflows/" + workflow_id + "/run"

    response = httpx.post(
        url,
        headers={"X-Auth-Token": api_key},
        json=inputs,
        timeout=600,  # 10 minutes
    )

    return response.json()


def parse_custom(component: Custom, workflow: Workflow) -> dspy.Module:
    class CustomNode(dspy.Module):
        def forward(self, **kwargs) -> Any:
            return apiCall(
                kwargs,
                workflow.api_key,
                langwatch.endpoint,
                component.workflow_id,
                component.version_id,
            )["result"]

    if component.behave_as == "evaluator":
        return EvaluatorWrapper(CustomNode())

    return CustomNode()


def parse_signature(
    node_id: str, component: Signature, workflow: Workflow
) -> dspy.Module:
    class_name = component.name or "AnonymousSignature"

    # Create a dictionary to hold the class attributes
    class_dict = {}
    annotations = {}

    field_type_to_dspy_type = {
        FieldType.image: dspy.Image,
        FieldType.str: str,
        FieldType.int: int,
        FieldType.float: float,
        FieldType.bool: bool,
        FieldType.list_str: list[str],
    }

    # Add input fields
    if component.inputs:
        for input_field in component.inputs:
            annotations[input_field.identifier] = field_type_to_dspy_type[
                input_field.type
            ]
            class_dict[input_field.identifier] = dspy.InputField()

    # Add output fields
    if component.outputs:
        for output_field in component.outputs:
            annotations[output_field.identifier] = field_type_to_dspy_type[
                output_field.type
            ]
            class_dict[output_field.identifier] = dspy.OutputField()

    class_dict["__annotations__"] = annotations

    parameters = parse_fields(component.parameters or [], autoparse=True)

    # Add the docstring (instructions) if available
    if instructions := cast(str, parameters.get("instructions")):
        class_dict["__doc__"] = instructions

    # Create the class dynamically
    SignatureClass: Union[type[dspy.Signature], dspy.Module] = type(
        class_name + "Signature", (dspy.Signature,), class_dict
    )

    if prompting_technique := cast(NodeRef, parameters.get("prompting_technique")):
        try:
            decorator_node = cast(
                PromptingTechniqueNode,
                next(
                    node
                    for node in workflow.nodes
                    if node.id == prompting_technique.ref
                ),
            )
        except StopIteration:
            raise ValueError(f"Decorator node {prompting_technique.ref} not found")
        PromptingTechniqueClass = parse_prompting_technique(decorator_node.data)
        predict = PromptingTechniqueClass(SignatureClass)  # type: ignore
    else:
        predict = dspy.Predict(SignatureClass)

    llm_config = cast(LLMConfig, parameters.get("llm"))
    if llm_config is None:
        raise ValueError(f"LLM is required for {component.name}")
    lm = node_llm_config_to_dspy_lm(llm_config)

    demonstrations = cast(NodeDataset, parameters.get("demonstrations"))
    demos: List[Dict[str, Any]] = []
    if demonstrations and demonstrations.inline:
        demos = transpose_inline_dataset_to_object_list(demonstrations.inline)

    return LLMNode(
        node_id=node_id, name=class_name, predict=predict, lm=lm, demos=demos
    )


def parse_code(node_id: str, component: Code, workflow: Workflow) -> dspy.Module:
    code = next(
        (
            param.value
            for param in (component.parameters or [])
            if param.identifier == "code"
        ),
        None,
    )
    if not code:
        raise ValueError(f"Could not find code for component {component.name}")

    namespace = {}
    try:
        exec(code, namespace)
    except Exception as e:
        raise ValueError(f"Error parsing code for component {component.name}: {e}")

    pattern = r"class (.*?)\(dspy\.Module\):"
    match = re.search(pattern, code)
    if not match:
        raise ValueError(
            f"Could not find a class that inherits from dspy.Module for component {component.name}"
        )
    class_name = match.group(1)

    module = namespace[class_name]
    return module()


def parse_prompting_technique(
    component: PromptingTechnique,
) -> PromptingTechniqueTypes:
    if not component.cls:
        raise ValueError("Prompting technique class not specified")
    return PROMPTING_TECHNIQUES[component.cls]


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

    settings = parse_fields(component.parameters or [], autoparse=True)
    return EVALUATORS[component.cls](**settings)


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
            autoparse_field_value(field, field.value) if autoparse else field.value
        )
        for field in fields
        if field.value
    }


def autoparse_field_value(field: Field, value: Optional[Any]) -> Optional[Any]:
    if type(value) == str and (
        value.startswith("{") or value.startswith("[") or value.startswith('"')
    ):
        try:
            value = json.loads(value)
        except ValueError:
            pass
    if value is None or value == "null" or value == "None":
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
    if field.type == FieldType.list_str:
        if isinstance(value, list):
            return [
                autoparse_field_value(
                    Field(identifier=field.identifier, type=FieldType.str), item
                )
                for item in value
            ]
        return [
            autoparse_field_value(
                Field(identifier=field.identifier, type=FieldType.str), value
            )
        ]
    if field.type == FieldType.llm:
        return LLMConfig.model_validate(value)
    if field.type == FieldType.prompting_technique:
        return NodeRef.model_validate(value)
    if field.type == FieldType.dataset:
        return NodeDataset.model_validate(value)
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
