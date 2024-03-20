from dotenv import load_dotenv
from mangum import Mangum

load_dotenv()

import langwatch_nlp.error_tracking
from fastapi import FastAPI


import langwatch_nlp.topic_clustering.batch_clustering as batch_clustering
import langwatch_nlp.topic_clustering.incremental_clustering as incremental_clustering
import langwatch_nlp.sentiment_analysis as sentiment_analysis

# Config
app = FastAPI()
batch_clustering.setup_endpoints(app)
incremental_clustering.setup_endpoints(app)
sentiment_analysis.setup_endpoints(app)

if __name__ != "__main__":
    handler = Mangum(app, lifespan="off")