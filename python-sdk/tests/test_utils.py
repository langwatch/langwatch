import json
from langchain_core.messages import HumanMessage
from langwatch.utils import SerializableWithStringFallback


def test_it_serializes_things():
    serialized = json.loads(
        json.dumps(
            {"messages": [HumanMessage(content="Hello")]},
            cls=SerializableWithStringFallback,
        )
    )

    assert serialized == {"messages": [{"content": "Hello", "role": "user"}]}
