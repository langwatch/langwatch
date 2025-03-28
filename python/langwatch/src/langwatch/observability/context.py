import contextvars

# Context variable for the current trace
stored_langwatch_trace = contextvars.ContextVar('stored_langwatch_trace')

# Context variable for the current span
stored_langwatch_span = contextvars.ContextVar('stored_langwatch_span') 
