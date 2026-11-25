# ACME notes

A one endpoint notes summarizer with a single OpenAI call, no framework, no
tracing and no tests. Its manifest is `requirements.txt`: no lock file, no
virtual environment. The guided onboarding scenarios that are about the folder
rather than the code share this one.

```
python3 -m pip install -r requirements.txt
python3 -m uvicorn app.main:app --port 8768
```
