import os
import sys
from pathlib import Path

# The service package, without installing it; and no model loading when lambda_handler is imported.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["PII_LAZY_INIT"] = "1"
