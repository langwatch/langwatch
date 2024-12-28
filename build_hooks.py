import os
from pathlib import Path
import shutil
from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        """Run before the build process begins"""

        parent_dir = Path(__file__).parent

        if not (parent_dir / "langwatch" / ".next").exists():
            raise ValueError(
                "Next.js build files not found. Please run 'npm run build' in the langwatch directory before building the Python package."
            )

        if Path("langwatch_server").exists():
            shutil.rmtree("langwatch_server")
        os.makedirs("langwatch_server", exist_ok=True)

        def ignore_files(dir, files):
            return [
                f
                for f in files
                if f == "node_modules"
                or f == ".venv"
                or f == ".next-saas"
                or f == "cache"
                or f == "notebooks"
                or f == ".DS_Store"
                or (f.startswith(".env") and f != ".env.example")
            ]

        shutil.copytree("langwatch", "langwatch_server/langwatch", ignore=ignore_files)
        shutil.copytree(
            "langwatch_nlp", "langwatch_server/langwatch_nlp", ignore=ignore_files
        )
        shutil.copytree("bin", "langwatch_server/bin", ignore=ignore_files)
        shutil.copy("build_hooks.py", "langwatch_server/build_hooks.py")
        Path("langwatch_server/__init__.py").touch()

        return super().initialize(version, build_data)
