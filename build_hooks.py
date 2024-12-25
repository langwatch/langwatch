from pathlib import Path
from hatchling.builders.hooks.plugin.interface import BuildHookInterface


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version, build_data):
        """Run before the build process begins"""
        webapp_dir = Path(__file__).parent / "langwatch"
        next_dir = webapp_dir / ".next"

        if not next_dir.exists():
            raise ValueError(
                "Next.js build files not found. Please run 'npm run build' in the langwatch directory before building the Python package."
            )

        return super().initialize(version, build_data)
