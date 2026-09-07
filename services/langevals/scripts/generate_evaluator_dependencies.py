#!/usr/bin/env python3
"""
Generate evaluator dependencies and extras for the root pyproject.toml.
Updates both [project.optional-dependencies] and [tool.uv.sources] sections.
"""

import os
import tomllib
import tomli_w

root_dir = os.getcwd()
evaluators_dir = os.path.join(root_dir, "evaluators")
pyproject_file = os.path.join(root_dir, "pyproject.toml")

with open(pyproject_file, "rb") as file:
    pyproject_data = tomllib.load(file)

evaluator_packages = [
    d
    for d in os.listdir(evaluators_dir)
    if os.path.isdir(os.path.join(evaluators_dir, d))
]

# Update optional dependencies
optional_deps = pyproject_data.setdefault("project", {}).setdefault("optional-dependencies", {})
uv_sources = pyproject_data.setdefault("tool", {}).setdefault("uv", {}).setdefault("sources", {})

package_names = []
for package in evaluator_packages:
    package_name = f"langevals-{package}"

    # Add to optional dependencies (each evaluator is its own extra)
    optional_deps[package] = [package_name]

    # Add workspace source
    uv_sources[package_name] = {"workspace": True}

    package_names.append(package_name)

# Add "all" extra that includes all evaluators
optional_deps["all"] = package_names

with open(pyproject_file, "wb") as file:
    tomli_w.dump(pyproject_data, file)

print("Updated pyproject.toml with generated evaluator dependencies and extras.")
