import asyncio
import os
from dotenv import load_dotenv
from mangum import Mangum

from langwatch_nlp.generate_proxy_config import generate_proxy_config

load_dotenv()

import langwatch_nlp.error_tracking
from fastapi import FastAPI


import langwatch_nlp.topic_clustering.batch_clustering as batch_clustering
import langwatch_nlp.topic_clustering.incremental_clustering as incremental_clustering
import langwatch_nlp.sentiment_analysis as sentiment_analysis
import litellm.proxy.proxy_server as litellm_proxy_server

# Config
app = FastAPI()
batch_clustering.setup_endpoints(app)
incremental_clustering.setup_endpoints(app)
sentiment_analysis.setup_endpoints(app)

async def proxy_startup():
    litellm_proxy_server.ProxyConfig()
    generate_proxy_config()
    litellm_proxy_server.save_worker_config(config="proxy_config.generated.yaml")
    app.mount("/proxy", litellm_proxy_server.app)
    await litellm_proxy_server.startup_event()

if os.getenv("PROXY_IS_ENABLED") == "1":
    loop = asyncio.get_event_loop()
    if not loop.is_running():
        loop.run_until_complete(proxy_startup())
    else:
        asyncio.ensure_future(proxy_startup())

if __name__ != "__main__":
    handler = Mangum(app, lifespan="off")
