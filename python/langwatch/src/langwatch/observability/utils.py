from uuid import uuid4

def generate_trace_id() -> str:
    """Generate a unique trace ID prefixed with 'trace_'."""
    return f"trace_{str(uuid4()).replace('-', '')}"

def generate_span_id() -> str:
    """Generate a unique span ID prefixed with 'span_'."""
    return f"span_{str(uuid4()).replace('-', '')}" 
