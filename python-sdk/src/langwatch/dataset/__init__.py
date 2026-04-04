"""
LangWatch Dataset module.

Exposes dataset CRUD operations via module-level attribute access that
delegates to a cached DatasetsFacade instance, following the prompts module
pattern.

Usage::

    import langwatch

    # List datasets
    result = langwatch.dataset.list_datasets()

    # Create a dataset
    info = langwatch.dataset.create_dataset("My Dataset", columns=[...])

    # Get a dataset with entries
    ds = langwatch.dataset.get_dataset("my-dataset")

Backward-compatible imports::

    from langwatch.dataset import get_dataset, Dataset, DatasetEntry, GetDatasetOptions

"""

from typing import Optional

from pydantic import BaseModel

from .dataset_facade import DatasetsFacade

# Re-export types that users may import directly.
from .types import (
    ColumnType,
    CreateFromFileResult,
    Dataset,
    DatasetEntry,
    DatasetInfo,
    DatasetRecord,
    PaginatedResult,
    Pagination,
    UploadResult,
)

__all__ = [
    "DatasetsFacade",
    "ColumnType",
    "CreateFromFileResult",
    "Dataset",
    "DatasetEntry",
    "DatasetInfo",
    "DatasetRecord",
    "PaginatedResult",
    "Pagination",
    "UploadResult",
    "GetDatasetOptions",
    "get_dataset",
]


# ── Backward-compatibility shims ──────────────────────────────────


class GetDatasetOptions(BaseModel):
    """Options for get_dataset(). Kept for backward compatibility."""

    ignore_tracing: Optional[bool] = False


def get_dataset(
    slug_or_id: str, options: Optional[GetDatasetOptions] = None
) -> Dataset:
    """
    Retrieve a dataset by slug or ID.

    This is the legacy entry point kept for backward compatibility.
    New code should use ``langwatch.dataset.get_dataset(slug_or_id)`` via
    the facade delegation (which routes here).
    """
    facade = _get_facade()
    ignore_tracing = bool(options and options.ignore_tracing)
    return facade.get_dataset(slug_or_id, ignore_tracing=ignore_tracing)


# ── Module-level facade delegation ────────────────────────────────

_facade_instance: Optional[DatasetsFacade] = None


def _get_facade() -> DatasetsFacade:
    """Get or create the cached DatasetsFacade instance."""
    global _facade_instance
    if _facade_instance is None:
        _facade_instance = DatasetsFacade.from_global()
    return _facade_instance


def __getattr__(name: str):
    """
    Delegate attribute access to the DatasetsFacade instance.

    Allows ``langwatch.dataset.list_datasets()`` etc. to work seamlessly
    as if ``langwatch.dataset`` were the facade itself.
    """
    facade = _get_facade()
    if hasattr(facade, name):
        return getattr(facade, name)
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
