import asyncio
from contextlib import asynccontextmanager
import contextlib
import multiprocessing
import os
from typing import Dict, List, Optional, Union
from dotenv import load_dotenv
from tempfile import mkdtemp

load_dotenv()
# Necessary for running DSPy on AWS lambdas
os.environ["DSP_CACHEDIR"] = mkdtemp()
os.environ["DSPY_CACHEDIR"] = mkdtemp()

from langwatch_nlp.studio.utils import (
    SerializableWithStringFallback,
)
import langwatch_nlp.error_tracking
from fastapi import FastAPI

from openai import OpenAI
from langwatch_nlp.logger import get_logger

logger = get_logger("main")

from langwatch_nlp.studio.app import app as studio_app, lifespan as studio_lifespan

import langwatch_nlp.topic_clustering.batch_clustering as batch_clustering
import langwatch_nlp.topic_clustering.incremental_clustering as incremental_clustering
import langwatch_nlp.sentiment_analysis as sentiment_analysis
import litellm.proxy.proxy_server as litellm_proxy_server

from litellm.router import Router

os.environ["AZURE_API_VERSION"] = "2024-06-01"
if "DATABASE_URL" in os.environ:
    # we need to delete this otherwise if this is present the proxy server tries to set up a db
    del os.environ["DATABASE_URL"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    lifespans = [
        litellm_proxy_server.proxy_startup_event,
        studio_lifespan,
    ]

    exit_stack = contextlib.AsyncExitStack()
    async with exit_stack:
        for lifespan in lifespans:
            await exit_stack.enter_async_context(lifespan(app))
        yield


# Config
app = FastAPI(lifespan=lifespan)
batch_clustering.setup_endpoints(app)
incremental_clustering.setup_endpoints(app)
sentiment_analysis.setup_endpoints(app)


app.mount("/studio", studio_app)


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


async def proxy_startup():
    logger.info("Proxy startup called")
    original_get_available_deployment = Router.async_get_available_deployment

    # Patch to be able to replace api_key and api_base on the fly from the parameters comming from langwatch according to user settings
    async def patched_get_available_deployment(
        self,
        model: str,
        request_kwargs: Dict,
        messages: Optional[List[Dict[str, str]]] = None,
        input: Optional[Union[str, List]] = None,
        specific_deployment: Optional[bool] = False,
        **kwargs,
    ):
        self.cache.flush_cache()  # prevents litellm proxing from storing failures and mark the deployment as "unhealthy" for everyone in case a single user's API key is invalid for example

        deployment = await original_get_available_deployment(
            self,
            model=model,
            request_kwargs=request_kwargs,
            messages=messages,
            input=input,
            specific_deployment=specific_deployment,
            **kwargs,
        )
        deployment = deployment.copy()

        logger.debug("LiteLLM deployment resolved", deployment_model=deployment.get("litellm_params", {}).get("model"), model=model)

        if "litellm_params" not in deployment:
            deployment["litellm_params"] = {}
        if request_kwargs is not None and "proxy_server_request" in request_kwargs:
            proxy_server_request = request_kwargs["proxy_server_request"]
            for header, value in proxy_server_request["headers"].items():
                if not header.startswith("x-litellm-"):
                    continue

                _, key = header.split("x-litellm-")
                key = key.replace("-", "_")

                deployment["litellm_params"][key] = value

        if (
            "azure/" in model
            and "api_version" not in deployment["litellm_params"]
            and "use_azure_gateway" not in deployment["litellm_params"]
        ):
            deployment["litellm_params"]["api_version"] = os.environ[
                "AZURE_API_VERSION"
            ]

        return deployment

    Router.async_get_available_deployment = patched_get_available_deployment

    litellm_proxy_server.ProxyConfig()
    litellm_proxy_server.save_worker_config(config="proxy_config.yaml")
    app.mount("/proxy", litellm_proxy_server.app)


# Dummy env vars just to get the proxy to start up
if "OPENAI_API_KEY" not in os.environ:
    os.environ["OPENAI_API_KEY"] = "dummy"
if "AZURE_OPENAI_API_KEY" not in os.environ:
    os.environ["AZURE_OPENAI_API_KEY"] = "dummy"

loop = asyncio.get_event_loop()
if not loop.is_running():
    loop.run_until_complete(proxy_startup())
else:
    asyncio.ensure_future(proxy_startup())

if __name__ == "__main__":
    multiprocessing.set_start_method("fork")
