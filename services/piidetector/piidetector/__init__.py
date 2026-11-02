"""PII detector, Level 0 (regex and validators) and Level 1 (Level 0 + GLiNER + PII-Tracer + name rule).

`combine.detect(text, level, gliner=..., tracer=...)` is the in-process API; `service.Detector`
is the request contract both entrypoints serve.
"""
