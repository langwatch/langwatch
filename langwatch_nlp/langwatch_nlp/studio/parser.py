from langwatch_nlp.studio.dspy.lite_llm import DSPyLiteLLM
from langwatch_nlp.studio.dspy.predict_with_metadata import PredictWithMetadata
from langwatch_nlp.studio.modules.registry import MODULES
from langwatch_nlp.studio.types.dsl import Evaluator, Node, Signature, Workflow
import dspy


def parse_component(node: Node, workflow: Workflow) -> type[dspy.Module]:
    match node.type:
        case "signature":
            return parse_signature(node.data, workflow)
        case "evaluator":
            return parse_evaluator(node.data)
        case _:
            raise NotImplementedError(f"Unknown component type: {node.type}")


def parse_signature(component: Signature, workflow: Workflow) -> type[dspy.Module]:
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

    lm = DSPyLiteLLM(
        max_tokens=llm_config.max_tokens or 2048,
        temperature=llm_config.temperature or 0,
        **(llm_config.litellm_params or {"model": llm_config.model}),
    )

    dspy.settings.configure(experimental=True)

    def __init__(self) -> None:
        PredictWithMetadata.__init__(self, SignatureClass)
        self.set_lm(lm=lm)

    ModuleClass: type[PredictWithMetadata] = type(
        class_name, (PredictWithMetadata,), {"__init__": __init__}
    )

    return ModuleClass


def parse_evaluator(component: Evaluator) -> type[dspy.Module]:
    if not component.cls:
        raise ValueError("Evaluator class not specified")

    return MODULES["evaluator"][component.cls]
