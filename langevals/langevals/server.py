from contextlib import asynccontextmanager
import os
import signal
import sys
import dotenv
from fastapi.responses import RedirectResponse

from langevals.utils import (
    get_cpu_count,
    get_evaluator_classes,
    get_evaluator_definitions,
    load_evaluator_packages,
)

dotenv.load_dotenv()

from fastapi import FastAPI, HTTPException, Request
from typing import List, Optional
from langevals_core.base_evaluator import (
    EvaluationResultSkipped,
    EvaluationResultError,
)
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from mangum import Mangum

import nest_asyncio

nest_asyncio_apply = nest_asyncio.apply
nest_asyncio.apply = lambda: None


def handle_sigterm(signum, frame):
    print("Received SIGTERM")
    raise SystemExit(0)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.getenv("RUNNING_IN_DOCKER"):
        signal.signal(signal.SIGTERM, handle_sigterm)
        signal.signal(signal.SIGINT, handle_sigterm)
    yield


app = FastAPI(lifespan=lifespan)

original_env = os.environ.copy()


def create_evaluator_routes(evaluator_cls):
    definitions = get_evaluator_definitions(evaluator_cls)
    module_name = definitions.module_name
    evaluator_name = definitions.evaluator_name
    entry_type = definitions.entry_type
    settings_type = definitions.settings_type
    result_type = definitions.result_type

    required_env_vars = (
        "\n\n__Env vars:__ " + ", ".join(definitions.env_vars)
        if len(definitions.env_vars) > 0
        else ""
    )
    docs_url = "\n\n__Docs:__ " + definitions.docs_url if definitions.docs_url else ""
    description = definitions.description + required_env_vars + docs_url

    class Request(BaseModel):
        model_config = ConfigDict(extra="forbid")

        data: List[entry_type] = Field(description="List of entries to be evaluated, check the field type for the necessary keys")  # type: ignore
        settings: Optional[settings_type] = Field(None, description="Evaluator settings, check the field type for what settings this evaluator supports")  # type: ignore
        env: Optional[dict[str, str]] = Field(
            None,
            description="Optional environment variables to override the server ones",
            json_schema_extra={"example": {}},
        )

    if not os.getenv("DISABLE_EVALUATORS_PRELOAD"):
        evaluator_cls.preload()

    @app.post(
        f"/{module_name}/{evaluator_name}/evaluate",
        name=f"{module_name}_{evaluator_name}_evaluate",
        description=description,
    )
    async def evaluate(
        req: Request,
    ) -> List[result_type | EvaluationResultSkipped | EvaluationResultError]:  # type: ignore
        if module_name == "ragas":
            nest_asyncio_apply()
        os.environ.clear()
        os.environ.update(
            original_env
        )  # always try to set env vars from the original env back again to avoid side effects
        evaluator = evaluator_cls(settings=(req.settings or {}), env=req.env)  # type: ignore
        result = evaluator.evaluate_batch(req.data)
        os.environ.clear()
        return result


evaluators = load_evaluator_packages()
for evaluator_name, evaluator_package in evaluators.items():
    module_name = evaluator_package.__name__.split("langevals_")[1]
    if (
        len(sys.argv) > 2
        and sys.argv[1] == "--only"
        and module_name not in sys.argv[2].split(",")
    ):
        continue
    print(f"Loading {evaluator_package.__name__}")
    for evaluator_cls in get_evaluator_classes(evaluator_package):
        create_evaluator_routes(evaluator_cls)


@app.get("/healthcheck")
async def healthcheck():
    return {"status": "healthy"}


@app.get("/")
async def redirect_to_docs():
    return RedirectResponse(url="/docs")


@app.exception_handler(ValidationError)
async def validation_exception_handler(request: Request, exc: ValidationError):
    raise HTTPException(
        status_code=400,
        detail=exc.errors(),
    )


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--preload":
        print("Preloading done")
        return
    if len(sys.argv) > 1 and sys.argv[1] == "--export-openapi-json":
        import json

        with open("openapi.json", "w") as f:
            f.write(json.dumps(app.openapi(), indent=2))
        print("openapi.json exported")
        return
    host = "0.0.0.0"
    port = int(os.getenv("PORT", 5562))

    if sys.platform == "darwin":
        import uvicorn

        print(f"LangEvals listening at http://{host}:{port}")

        uvicorn.run(
            app,
            host=host,
            port=port,
            log_level="warning",
            timeout_keep_alive=900,
        )
    else:
        import gunicorn.app.base

        workers = get_cpu_count()

        class StandaloneApplication(gunicorn.app.base.BaseApplication):
            def __init__(self, app, options=None):
                self.options = options or {}
                self.application = app
                super().__init__()

            def load_config(self):
                config = {
                    key: value
                    for key, value in self.options.items()
                    if key in self.cfg.settings and value is not None
                }  # type: ignore
                for key, value in config.items():
                    self.cfg.set(key.lower(), value)  # type: ignore

            def load(self):
                print(f"LangEvals listening at http://{host}:{port}")
                return self.application

        print(f"Starting server with {workers} workers")

        options = {
            "bind": f"{host}:{port}",
            "workers": workers,
            "worker_class": "uvicorn.workers.UvicornWorker",
            "preload_app": True,
            "forwarded_allow_ips": "*",
            "loglevel": "warning",
            "timeout": 900,
        }

        StandaloneApplication(app, options).run()


if __name__ == "__main__":
    main()
else:
    handler = Mangum(app, lifespan="off")
