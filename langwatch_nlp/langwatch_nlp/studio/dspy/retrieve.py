from typing import List, Optional, Union
import dspy


class ContextsRetriever(dspy.Module):
    def __init__(self, *, rm, k: int = 3, **kwargs):
        super().__init__()

    def forward(self, query: Union[str, List[str]], **kwargs):
        raise NotImplementedError("Retrievers are no longer supported, please use the Code block instead to call your data source directly.")


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
        super().__init__()

    def forward(self, query: Union[str, List[str]], **kwargs):
        raise NotImplementedError("Retrievers are no longer supported, please use the Code block instead to call your data source directly.")


class ColBERTv2RM(dspy.Module):
    def __init__(self, k: int = 3, **kwargs):
        super().__init__()

    def forward(self, query: Union[str, List[str]], **kwargs):
        raise NotImplementedError("Retrievers are no longer supported, please use the Code block instead to call your data source directly.")
