from typing import cast
from langwatch_nlp.studio.types.dsl import Node, Signature
import dspy

from langwatch_nlp.studio.utils import print_class_definition


def parse_component(node: Node) -> type[dspy.Signature] | type[dspy.Module]:
    match node.type:
        case "signature":
            return parse_signature(node.data)
        case _:
            raise NotImplementedError(f"Unknown component type: {node.type}")


def parse_signature(component: Signature) -> type[dspy.Signature]:
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
    SignatureClass: type[dspy.Signature] = type(class_name, (dspy.Signature,), class_dict)

    return SignatureClass
