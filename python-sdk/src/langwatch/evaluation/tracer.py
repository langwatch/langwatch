from opentelemetry import trace

tracer = trace.get_tracer(__name__)
