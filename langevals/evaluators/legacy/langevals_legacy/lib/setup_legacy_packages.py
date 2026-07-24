import sys
import os


def setup_legacy_packages():
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "vendor"))
