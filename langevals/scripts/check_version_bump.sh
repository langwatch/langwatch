#!/bin/bash

PACKAGE_DIR="${1:-.}"

if [ ! -f "$PACKAGE_DIR/pyproject.toml" ]; then
    echo "Error: pyproject.toml not found in $PACKAGE_DIR"
    exit 1
fi

cd "$PACKAGE_DIR"

# Get package name and version using Python (uv has no version command)
PACKAGE_NAME=$(python3 -c "import tomllib; print(tomllib.load(open('pyproject.toml', 'rb'))['project']['name'])")
CURRENT_VERSION=$(python3 -c "import tomllib; print(tomllib.load(open('pyproject.toml', 'rb'))['project']['version'])")

# Fetch the published package metadata from PyPI
REMOTE_METADATA=$(curl -s https://pypi.org/pypi/$PACKAGE_NAME/$CURRENT_VERSION/json)

# Check if the package has been published
if echo "$REMOTE_METADATA" | grep -q "Not Found"; then
    echo "$PACKAGE_NAME $CURRENT_VERSION has not been published yet."
    exit 0
fi

# Build the package and calculate the md5 digest of the distribution file
rm -rf dist
uv build
DIST_FILE=$(ls dist/*.whl)
LOCAL_DIGEST=$(md5sum "$DIST_FILE" | cut -d' ' -f1)
# Clean up the build artifacts
rm -rf dist

# Extract the remote digest and compare it with the local digest
REMOTE_DIGEST=$(echo "$REMOTE_METADATA" | jq -r '.urls[0].digests.md5')
if [ "$REMOTE_DIGEST" != "$LOCAL_DIGEST" ]; then
    echo "[Error 3] $PACKAGE_NAME has changed and needs a version bump."
    exit 3
else
    echo "$PACKAGE_NAME is up to date."
fi
