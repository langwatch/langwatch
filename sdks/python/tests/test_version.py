import re
import tomllib
from pathlib import Path

def test_version_consistency():
    """Test that the version in pyproject.toml matches the version in __version__.py"""

    # Get the project root directory (parent of tests directory)
    project_root = Path(__file__).parent.parent

    # Read version from pyproject.toml
    pyproject_path = project_root / "pyproject.toml"
    with open(pyproject_path, "rb") as f:
        pyproject_data = tomllib.load(f)
    pyproject_version = pyproject_data["project"]["version"]

    # Read version from __version__.py
    version_file_path = project_root / "src" / "langwatch" / "__version__.py"
    with open(version_file_path, "r") as f:
        version_file_content = f.read()

    # Extract version using regex
    version_match = re.search(r'__version__\s*=\s*["\']([^"\']+)["\']', version_file_content)
    assert version_match is not None, "Could not find __version__ in __version__.py"
    file_version = version_match.group(1)

    # Assert versions match
    assert pyproject_version == file_version, (
        f"Version mismatch: pyproject.toml has '{pyproject_version}' "
        f"but __version__.py has '{file_version}'"
    )