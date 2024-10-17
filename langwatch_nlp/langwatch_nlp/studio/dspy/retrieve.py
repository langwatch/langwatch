import time
from typing import List, Optional, Union
import dspy
import weaviate
from dspy.retrieve.weaviate_rm import WeaviateRM


class ContextsRetriever(dspy.Module):
    def __init__(self, *, rm: type[dspy.retrieve.Retrieve], k: int = 3, **kwargs):
        self.rm = rm(**kwargs)
        self.k = k

    def forward(self, query: Union[str, List[str]], **kwargs):
        passages = self.rm(query, k=self.k, **kwargs)
        return {
            "contexts": (
                passages.passages  # type: ignore
                if hasattr(passages, "passages")
                else passages
            )
        }


class WeaviateRMWithConnection(WeaviateRM):
    def __init__(
        self, weaviate_url: str, weaviate_api_key: Optional[str] = None, **kwargs
    ):
        client = weaviate.connect_to_weaviate_cloud(
            cluster_url=weaviate_url,
            auth_credentials=weaviate.Auth.api_key(weaviate_api_key),
        )
        super().__init__(weaviate_client=client, **kwargs)


class ColBERTv2RM(dspy.Retrieve):
    def __init__(self, k: int = 3, **kwargs):
        self.rm = dspy.ColBERTv2(**kwargs)
        super().__init__(k=k)

    def forward(self, query: Union[str, List[str]], **kwargs):
        attempts = 0
        with dspy.context(rm=self.rm):
            # ColBERTv2 sometimes fails but a few retries makes it reliable again
            while attempts < 5:
                try:
                    return dspy.Retrieve.forward(self, query, **kwargs)
                except KeyError as e:
                    attempts += 1
                    time.sleep(0.1 * (attempts * 2))
                    if attempts >= 5:
                        raise e
                    else:
                        print(f"Retrying ColBERTv2 (attempt {attempts})...")
