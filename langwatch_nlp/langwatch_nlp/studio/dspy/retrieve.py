import time
from typing import List, Optional, Union
import dspy
import weaviate
from dspy.retrieve.weaviate_rm import WeaviateRM


class ContextsRetriever(dspy.Module):
    def __init__(self, *, rm: type[dspy.retrieve.Retrieve], k: int = 3, **kwargs):
        self._rm = rm(**kwargs)
        self.k = k

    def forward(self, query: Union[str, List[str]], **kwargs):
        passages = self._rm(query, k=self.k, **kwargs)
        return {
            "contexts": (
                passages.passages  # type: ignore
                if hasattr(passages, "passages")
                else passages
            )
        }


class WeaviateRMWithConnection(dspy.Retrieve):
    def __init__(
        self,
        weaviate_url: str,
        weaviate_collection_name: str,
        weaviate_collection_text_key: Optional[str] = "content",
        weaviate_api_key: Optional[str] = None,
        embedding_header_key: Optional[str] = None,
        embedding_header_value: Optional[str] = None,
        k: int = 3,
    ):
        self.weaviate_url = weaviate_url
        self.weaviate_collection_name = weaviate_collection_name
        self.weaviate_collection_text_key = weaviate_collection_text_key
        self.weaviate_api_key = weaviate_api_key
        self.embedding_header_key = embedding_header_key
        self.embedding_header_value = embedding_header_value
        self.k = k
        self.rm = dspy.ColBERTv2(url="http://20.102.90.50:2017/wiki17_abstracts")
        super().__init__(k=k)

    def forward(self, query: Union[str, List[str]], **kwargs):
        client = weaviate.connect_to_weaviate_cloud(
            cluster_url=self.weaviate_url,
            auth_credentials=(
                weaviate.classes.init.Auth.api_key(self.weaviate_api_key)
                if self.weaviate_api_key
                else None
            ),
            headers=(
                {
                    self.embedding_header_key: self.embedding_header_value,
                }
                if self.embedding_header_key and self.embedding_header_value
                else None
            ),
        )

        rm = WeaviateRM(
            weaviate_client=client,
            weaviate_collection_name=self.weaviate_collection_name,
            weaviate_collection_text_key=self.weaviate_collection_text_key,
            k=self.k,
        )
        result = rm.forward(query, **kwargs)
        client.close()
        return result


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
