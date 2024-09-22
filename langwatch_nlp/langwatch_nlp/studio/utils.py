import ast
import builtins
import inspect
import keyword
import re

from joblib.memory import MemorizedFunc, AsyncMemorizedFunc


def print_class_definition(cls):
    print(
        f"class {cls.__name__}({', '.join(base.__name__ for base in cls.__bases__)}):"
    )

    # Print docstring if it exists
    if cls.__doc__:
        print(f'    """{cls.__doc__}"""')

    # Print class attributes
    for name, value in cls.__dict__.items():
        if (
            not name.startswith("__")
            and not inspect.isfunction(value)
            and not inspect.ismethod(value)
        ):
            print(f"    {name} = {repr(value)}")

    # Print methods
    for name, value in cls.__dict__.items():
        if inspect.isfunction(value) or inspect.ismethod(value):
            signature = inspect.signature(value)
            print(f"    def {name}{signature}:")
            if value.__doc__:
                print(f'        """{value.__doc__}"""')
            print("        pass")

    print()  # Add a blank line at the end


def disable_dsp_caching():
    MemorizedFunc._is_in_cache_and_valid = lambda *args, **kwargs: False
    AsyncMemorizedFunc._is_in_cache_and_valid = lambda *args, **kwargs: False


def print_ast(node):
    print("\n\n" + ast.unparse(node) + "\n\n")


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
