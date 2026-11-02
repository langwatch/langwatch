"""AWS Lambda entrypoint (image CMD "piidetector.lambda_handler.handler").

The models load at import, which Lambda runs in its init phase, so the cold start pays for
loading and the first invocation does not. The event is the request described in service.py.
A malformed request raises, which Lambda reports as a function error.
"""

import os

from .service import Detector

DETECTOR = None


def get_detector():
    global DETECTOR
    if DETECTOR is None:
        DETECTOR = Detector.from_environment()
    return DETECTOR


def handler(event, context=None):
    return get_detector().handle(event)


# Tests import this module without models and inject a Detector.
if os.environ.get("PII_LAZY_INIT") != "1":
    get_detector()
