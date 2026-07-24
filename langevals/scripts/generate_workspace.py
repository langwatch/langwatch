import os
import json

root_dir = os.getcwd()  # Assumes this script is run from the root of the monorepo
evaluators_dir = os.path.join(root_dir, "evaluators")
core_dir = os.path.join(root_dir, "langevals_core")
workspace_file = os.path.join(root_dir, "langevals.code-workspace")

evaluator_paths = [
    os.path.join(evaluators_dir, d)
    for d in os.listdir(evaluators_dir)
    if os.path.isdir(os.path.join(evaluators_dir, d))
]

folders = [
    {"path": "."},
    {"path": "langevals_core"},
    {"path": "notebooks"},
]
folders.extend([{"path": os.path.relpath(path, root_dir)} for path in evaluator_paths])

settings_folders = []
for folder in folders:
    folder_path = folder["path"]
    if folder_path == ".":
        continue

    venv_path = os.path.join(folder_path, ".venv")
    if os.path.exists(venv_path):
        interpreter_path = os.path.join(
            "${workspaceFolder:" + folder_path + "}", ".venv", "bin", "python"
        )
        settings_folders.append(
            {
                "path": folder_path,
                "settings": {"python.defaultInterpreterPath": interpreter_path},
            }
        )

settings = {
    "python.defaultInterpreterPath": "${workspaceFolder}/.venv/bin/python",
    "folders": settings_folders,
}

workspace_content = {
    "folders": folders,
    "settings": settings,
}

with open(workspace_file, "w") as f:
    json.dump(workspace_content, f, indent=2)

print(f"Workspace configuration generated at {workspace_file}")
