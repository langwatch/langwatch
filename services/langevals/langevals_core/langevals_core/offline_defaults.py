"""Outbound calls the libraries inside LangEvals would make on their own.

Import this module before the first `import litellm` or `import ragas` in a
process. It is a side-effect import on purpose: LiteLLM reads its cost map
switch at import time, so setting it any later is too late.

- LiteLLM would download its model price list from raw.githubusercontent.com
  at import. LangEvals prices calls from LangWatch's own model catalog (see
  model_pricing.py) on top of the copy bundled with the pinned LiteLLM, so the
  download is never needed and is always switched off.
- RAGAS would send usage analytics to t.explodinggradients.com. Off unless the
  operator explicitly sets RAGAS_DO_NOT_TRACK=false.
"""

import os

os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
os.environ.setdefault("RAGAS_DO_NOT_TRACK", "true")
