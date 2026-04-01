"""
Domain types for the LangWatch Dataset module.

Pydantic models for dataset API responses and request payloads.
All models use ConfigDict(extra="ignore") to tolerate unknown fields
from the API without breaking deserialization.
"""

from typing import Any, Dict, Generic, List, Optional, TypeVar
from pydantic import BaseModel, ConfigDict


class ColumnType(BaseModel):
    """A column definition for a dataset schema."""

    model_config = ConfigDict(extra="ignore")

    name: str
    type: str


class DatasetInfo(BaseModel):
    """
    Dataset metadata returned by list, create, update, and delete operations.

    Does not include record entries -- use get_dataset() for full data.
    """

    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    slug: str
    columnTypes: List[ColumnType] = []
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None
    recordCount: Optional[int] = None


class DatasetEntry(BaseModel):
    """A single entry (row) within a dataset."""

    model_config = ConfigDict(extra="ignore")

    id: str
    entry: Dict[str, Any]


class Dataset(BaseModel):
    """
    Full dataset with entries, returned by get_dataset().

    Provides a to_pandas() helper for conversion to a pandas DataFrame.
    """

    model_config = ConfigDict(extra="ignore")

    id: str = ""
    name: str = ""
    slug: str = ""
    entries: List[DatasetEntry] = []

    def to_pandas(self):
        """
        Convert entries to a pandas DataFrame.

        Raises:
            ImportError: If pandas is not installed.
        """
        try:
            import pandas as pd
        except ImportError:
            raise ImportError(
                "pandas is required for to_pandas(). "
                "Install it with: pip install pandas"
            )
        return pd.DataFrame([entry.entry for entry in self.entries])


class DatasetRecord(BaseModel):
    """A record as returned by create/update record operations."""

    model_config = ConfigDict(extra="ignore")

    id: str
    datasetId: Optional[str] = None
    projectId: Optional[str] = None
    entry: Dict[str, Any] = {}
    createdAt: Optional[str] = None
    updatedAt: Optional[str] = None


class Pagination(BaseModel):
    """Pagination metadata for list operations."""

    model_config = ConfigDict(extra="ignore")

    page: int
    limit: int
    total: int
    totalPages: int


T = TypeVar("T")


class PaginatedResult(BaseModel, Generic[T]):
    """A paginated API response containing a data list and pagination metadata."""

    model_config = ConfigDict(extra="ignore")

    data: List[T]
    pagination: Pagination


class UploadResult(BaseModel):
    """Result of uploading a file to an existing dataset."""

    model_config = ConfigDict(extra="ignore")

    datasetId: Optional[str] = None
    recordsCreated: int = 0


class CreateFromFileResult(BaseModel):
    """Result of creating a new dataset from a file upload."""

    model_config = ConfigDict(extra="ignore")

    dataset: DatasetInfo
    recordsCreated: int = 0
