"""The resolution layer: request env in, litellm call arguments out.

Evaluators used to bridge request `env` to litellm by writing it into
`os.environ`, some of them the whole dict. That is a cross-request boundary:
with two evaluations in flight, whichever wrote last supplied credentials to
both. The replacement resolves the request env into explicit call arguments,
and these tests pin that resolution: which variable becomes which argument,
which provider it applies to, what an explicit argument outranks, and that
nothing reaches the process environment on the way.

The same contract proved end to end, through every evaluator family that used
to write, is in test_evaluator_credential_isolation.py.
"""

import os
import sys

# Same import guard as the other files in this directory (they must agree,
# since the first file pytest collects is the one that actually imports the
# module): `langevals.server` reads sys.argv and DISABLE_EVALUATORS_PRELOAD at
# import time, and both are restored right after.
_original_argv = sys.argv
_original_preload = os.environ.get("DISABLE_EVALUATORS_PRELOAD")
sys.argv = ["server.py", "--only", "langevals,ragas"]
os.environ["DISABLE_EVALUATORS_PRELOAD"] = "1"
try:
    from langevals import server  # noqa: F401  (imports and patches litellm)
finally:
    sys.argv = _original_argv
    if _original_preload is None:
        os.environ.pop("DISABLE_EVALUATORS_PRELOAD", None)
    else:
        os.environ["DISABLE_EVALUATORS_PRELOAD"] = _original_preload

# The server captured its baseline while the temporary preload flag was set.
# Rebase it on the clean environment, so the drift tripwire compares against
# what the process actually holds.
server.original_env = os.environ.copy()

from langevals_core.litellm_patch import patch_litellm_params
from langevals_core.request_env import request_env

def environment_snapshot() -> dict:
    # PYTEST_CURRENT_TEST is pytest's own per-phase marker and changes under
    # our feet; everything else must stay byte-identical.
    return {k: v for k, v in os.environ.items() if k != "PYTEST_CURRENT_TEST"}


# ---------------------------------------------------------------------------
# The resolution layer itself, kwargs in, kwargs out.
# ---------------------------------------------------------------------------


def test_azure_credentials_resolve_into_call_arguments():
    with request_env(
        {
            "AZURE_OPENAI_API_KEY": "req-azure-key",
            "AZURE_OPENAI_ENDPOINT": "https://req.example.com",
        }
    ):
        kwargs = patch_litellm_params({"model": "azure/gpt-4o"})
    assert kwargs["api_key"] == "req-azure-key"
    assert kwargs["api_base"] == "https://req.example.com"


def test_azure_litellm_names_win_over_the_openai_spellings():
    with request_env(
        {
            "AZURE_API_KEY": "litellm-name",
            "AZURE_OPENAI_API_KEY": "openai-name",
        }
    ):
        kwargs = patch_litellm_params({"model": "azure/gpt-4o"})
    assert kwargs["api_key"] == "litellm-name"


def test_openai_credentials_resolve_for_bare_model_names():
    with request_env({"OPENAI_API_KEY": "req-openai-key"}):
        kwargs = patch_litellm_params({"model": "gpt-5-mini"})
    assert kwargs["api_key"] == "req-openai-key"


def test_credentials_of_another_provider_do_not_apply():
    with request_env({"OPENAI_API_KEY": "req-openai-key"}):
        kwargs = patch_litellm_params({"model": "anthropic/claude-sonnet-5"})
    assert "api_key" not in kwargs


def test_an_explicit_call_argument_wins_over_the_request_env():
    with request_env({"AZURE_API_VERSION": "from-env"}):
        kwargs = patch_litellm_params(
            {"model": "azure/gpt-4o", "api_version": "explicit"}
        )
    assert kwargs["api_version"] == "explicit"


def test_x_litellm_variables_win_over_the_credential_mapping():
    with request_env(
        {"OPENAI_API_KEY": "mapped", "X_LITELLM_api_key": "passthrough"}
    ):
        kwargs = patch_litellm_params({"model": "openai/gpt-5-mini"})
    assert kwargs["api_key"] == "passthrough"


def test_the_deployment_name_rewrite_reads_the_request_env():
    with request_env({"AZURE_DEPLOYMENT_NAME": "my-deployment"}):
        kwargs = patch_litellm_params({"model": "azure/gpt-4o"})
    assert kwargs["model"] == "azure/my-deployment"
    with request_env({"AZURE_DEPLOYMENT_NAME": "my-deployment"}):
        kwargs = patch_litellm_params({"model": "openai/gpt-5-mini"})
    assert kwargs["model"] == "openai/gpt-5-mini"


def test_bedrock_credentials_resolve_into_call_arguments():
    """Temporary AWS credentials need all three parts on the call.

    An assumed role gives an access key, a secret and a session token, and
    the provider rejects the pair without the token.
    """
    with request_env(
        {
            "AWS_ACCESS_KEY_ID": "req-access-key",
            "AWS_SECRET_ACCESS_KEY": "req-secret-key",
            "AWS_SESSION_TOKEN": "req-session-token",
            "AWS_REGION_NAME": "eu-central-1",
        }
    ):
        kwargs = patch_litellm_params({"model": "bedrock/anthropic.claude-sonnet-4"})
    assert kwargs["aws_access_key_id"] == "req-access-key"
    assert kwargs["aws_secret_access_key"] == "req-secret-key"
    assert kwargs["aws_session_token"] == "req-session-token"
    assert kwargs["aws_region_name"] == "eu-central-1"


def test_vertex_credentials_resolve_from_the_request_env():
    with request_env({"GOOGLE_APPLICATION_CREDENTIALS": "req-google-credentials"}):
        kwargs = patch_litellm_params({"model": "vertex_ai/gemini-2.5-pro"})
    assert kwargs["vertex_credentials"] == "req-google-credentials"


def test_an_explicit_vertex_credential_wins_over_the_request_env():
    with request_env({"GOOGLE_APPLICATION_CREDENTIALS": "from-request"}):
        kwargs = patch_litellm_params(
            {"model": "vertex_ai/gemini-2.5-pro", "vertex_credentials": "explicit"}
        )
    assert kwargs["vertex_credentials"] == "explicit"


def test_the_server_vertex_credential_reaches_vertex_calls_only(monkeypatch):
    """The server's own Google credentials are a vertex fallback.

    They belong to the vertex call that has none of its own. Attaching them
    to a call for another provider gives it an argument it cannot use.
    """
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", "server-google-credentials")

    with request_env({}):
        vertex = patch_litellm_params({"model": "vertex_ai/gemini-2.5-pro"})
        openai = patch_litellm_params({"model": "openai/gpt-5-mini"})

    assert vertex["vertex_credentials"] == "server-google-credentials"
    assert "vertex_credentials" not in openai


def test_resolution_never_writes_the_environment():
    before = environment_snapshot()
    with request_env(
        {
            "AZURE_OPENAI_API_KEY": "req-azure-key",
            "X_LITELLM_api_key": "passthrough",
            "AZURE_DEPLOYMENT_NAME": "my-deployment",
        }
    ):
        patch_litellm_params({"model": "azure/gpt-4o"})
    assert environment_snapshot() == before
