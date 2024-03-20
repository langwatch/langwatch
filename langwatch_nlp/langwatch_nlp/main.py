from dotenv import load_dotenv

load_dotenv()

import error_tracking
from fastapi import FastAPI


import topic_clustering.batch_clustering as batch_clustering
import topic_clustering.incremental_clustering as incremental_clustering
import sentiment_analysis

# Config
app = FastAPI()
batch_clustering.setup_endpoints(app)
incremental_clustering.setup_endpoints(app)
sentiment_analysis.setup_endpoints(app)
