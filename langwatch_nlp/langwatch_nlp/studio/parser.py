import ast
import builtins
import keyword
import re
from typing import Dict, List, Tuple, cast
from langwatch_nlp.studio.dspy.lite_llm import DSPyLiteLLM
from langwatch_nlp.studio.dspy.reporting_module import ReportingModule
from langwatch_nlp.studio.types.dsl import Node, Signature, Workflow
import dspy


def parse_component(node: Node, workflow: Workflow) -> type[dspy.Module]:
    match node.type:
        case "signature":
            return parse_signature(node.data, workflow)
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
        dspy.Predict.__init__(self, SignatureClass)
        self.set_lm(lm=lm)

    ModuleClass: type[dspy.Predict] = type(
        class_name, (dspy.Predict,), {"__init__": __init__}
    )

    return ModuleClass


def parse_workflow(workflow: Workflow) -> Tuple[ReportingModule, ast.Module]:
    # Step 0: Pre-parse components
    parsed_components: Dict[str, type[dspy.Module]] = {}
    for node in workflow.nodes:
        if node.type not in ["entry", "end"]:
            parsed_components[node.id] = parse_component(node, workflow)

    # Step 2: Prepare the class structure
    class_name = (
        re.sub(
            r"^[^a-zA-Z_]+|[^0-9a-zA-Z_]", "_", workflow.name.replace(" ", "")
        ).strip("_")
        or "AnonymousWorkflow"
    )
    class_def = ast.ClassDef(
        name=validate_identifier(class_name),
        bases=[ast.Name(id="ReportingModule", ctx=ast.Load())],
        keywords=[],
        body=[],
        decorator_list=[],
        type_params=[],
    )

    # Step 3: Create the __init__ method
    init_method = ast.FunctionDef(
        name="__init__",
        args=ast.arguments(
            posonlyargs=[],
            args=[ast.arg(arg="self")],
            kwonlyargs=[],
            kw_defaults=[],
            defaults=[],
        ),
        body=[
            ast.Expr(
                ast.Call(
                    func=ast.Attribute(
                        value=ast.Call(
                            func=ast.Name(id="super", ctx=ast.Load()),
                            args=[],
                            keywords=[],
                        ),
                        attr="__init__",
                        ctx=ast.Load(),
                    ),
                    args=[],
                    keywords=[],
                )
            )
        ],
        decorator_list=[],
        type_params=[],
    )

    # Add component assignments to __init__
    for node_id in parsed_components:
        init_method.body.append(
            ast.Assign(
                targets=[
                    ast.Attribute(
                        value=ast.Name(id="self", ctx=ast.Load()),
                        attr=validate_identifier(node_id),
                        ctx=ast.Store(),
                    )
                ],
                value=ast.Call(
                    func=ast.Name(
                        id=validate_identifier(parsed_components[node_id].__name__),
                        ctx=ast.Load(),
                    ),
                    args=[],
                    keywords=[],
                ),
            )
        )

    class_def.body.append(init_method)

    # Step 4: Create the forward method
    forward_method = create_forward_method(workflow)
    class_def.body.append(forward_method)

    # Step 5: Wrap the class definition in a module
    module = ast.Module(body=[class_def], type_ignores=[])

    # Step 6: Create a controlled namespace for the functions
    namespace = globals() | {
        validate_identifier(k): v for k, v in parsed_components.items()
    }
    namespace["ReportingModule"] = ReportingModule

    # Step 7: Compile and execute the AST
    compiled_module = compile(
        ast.fix_missing_locations(module), filename="<ast>", mode="exec"
    )
    module_dict: Dict[str, type[dspy.Module]] = {}

    # New Step: Convert AST to source code and check for syntax errors
    try:
        generated_source = ast.unparse(module)
        compile(generated_source, "<string>", "exec")
    except SyntaxError:
        raise ValueError(f"Generated code has syntax errors")

    exec(compiled_module, namespace, module_dict)

    # Return both the AST and the compiled dspy.Module
    return cast(ReportingModule, module_dict[class_name]), module


def create_forward_method(workflow: Workflow) -> ast.FunctionDef:
    entry_node = next(node for node in workflow.nodes if node.type == "entry")
    end_node = next((node for node in workflow.nodes if node.type == "end"), None)

    # Create forward method signature
    forward_args = (
        [ast.arg(arg="self")]
        + [
            ast.arg(arg=validate_identifier(output.identifier))
            for output in entry_node.data.outputs
        ]
        if entry_node.data.outputs
        else []
    )

    forward_method = ast.FunctionDef(
        name="forward",
        args=ast.arguments(
            posonlyargs=[],
            args=forward_args,
            kwonlyargs=[],
            kw_defaults=[],
            defaults=[],
        ),
        body=[],
        decorator_list=[],
        type_params=[],
    )

    # Create a dictionary to store node outputs
    node_outputs: Dict[str, Dict[str, ast.Name]] = {
        validate_identifier(node.id): {} for node in workflow.nodes
    }

    # Process nodes in topological order
    executable_nodes = [
        node for node in workflow.nodes if node.type != "entry" and node.type != "end"
    ]
    processed_nodes: List[str] = []
    i = 0
    while len(processed_nodes) < len(executable_nodes):  # Exclude entry and end nodes
        if i > len(executable_nodes):
            raise ValueError("Workflow has a cycle")
        i += 1
        for node in executable_nodes:
            if node.id in processed_nodes:
                continue

            if not all(
                edge.source in processed_nodes
                or next(n for n in workflow.nodes if n.id == edge.source).type
                == "entry"
                for edge in workflow.edges
                if edge.target == node.id
            ):
                continue

            # All dependencies are processed, we can add this node
            call_args = []
            for edge in workflow.edges:
                if edge.target == node.id:
                    source_node = next(n for n in workflow.nodes if n.id == edge.source)
                    if source_node.type == "entry":
                        call_args.append(
                            ast.keyword(
                                arg=edge.targetHandle.split(".")[-1],
                                value=ast.Name(
                                    id=validate_identifier(
                                        edge.sourceHandle.split(".")[-1]
                                    ),
                                    ctx=ast.Load(),
                                ),
                            )
                        )
                    else:
                        call_args.append(
                            ast.keyword(
                                arg=edge.targetHandle.split(".")[-1],
                                value=ast.Attribute(
                                    value=node_outputs[edge.source][
                                        validate_identifier(
                                            edge.sourceHandle.split(".")[-1]
                                        )
                                    ],
                                    attr=validate_identifier(
                                        edge.sourceHandle.split(".")[-1]
                                    ),
                                    ctx=ast.Load(),
                                ),
                            )
                        )

            output_var_store = ast.Name(
                id=validate_identifier(f"{node.id}_output"), ctx=ast.Store()
            )
            output_var_load = ast.Name(
                id=validate_identifier(f"{node.id}_output"), ctx=ast.Load()
            )
            forward_method.body.append(
                # plain statement, just putting the output_var there on the body
                ast.Assign(
                    targets=[output_var_store],
                    value=ast.Call(
                        func=ast.Call(
                            func=ast.Attribute(
                                value=ast.Name(id="self", ctx=ast.Load()),
                                attr="with_reporting",
                                ctx=ast.Load(),
                            ),
                            args=[
                                ast.Attribute(
                                    value=ast.Name(id="self", ctx=ast.Load()),
                                    attr=node.id,
                                    ctx=ast.Load(),
                                ),
                            ],
                            keywords=[],
                        ),
                        args=[],
                        keywords=call_args,
                    ),
                )
            )
            node_outputs[node.id] = {
                output.identifier: output_var_load for output in node.data.outputs or []
            }
            processed_nodes.append(node.id)

    # Create return statement
    return_dict = (
        ast.Dict(
            keys=[
                ast.Constant(value=validate_identifier(input.identifier))
                for input in end_node.data.inputs or []
            ],
            values=[
                ast.Attribute(
                    value=node_outputs[edge.source][
                        validate_identifier(edge.sourceHandle.split(".")[-1])
                    ],
                    attr=validate_identifier(edge.sourceHandle.split(".")[-1]),
                    ctx=ast.Load(),
                )
                for edge in workflow.edges
                if edge.target == end_node.id
            ],
        )
        if end_node
        else ast.Dict(keys=[], values=[])
    )
    forward_method.body.append(ast.Return(value=return_dict))

    return forward_method


def validate_identifier(identifier: str) -> str:
    """Validate and sanitize an identifier."""
    # Only allow alphanumeric characters and underscores, must start with a letter or underscore
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", identifier):
        raise ValueError(f"Invalid identifier: {identifier}")
    # Check its also not a reserved word
    if (
        keyword.iskeyword(identifier)
        or identifier in dir(builtins)
        or identifier == "self"
    ):
        raise ValueError(f"Reserved identifier cannot be used: {identifier}")
    return identifier
