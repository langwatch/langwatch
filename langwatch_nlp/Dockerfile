FROM python:3.11-slim

WORKDIR /usr/src/app

RUN pip install poetry

COPY poetry.toml poetry.lock pyproject.toml .
RUN poetry install

COPY . .

EXPOSE 8080

CMD poetry run uvicorn langwatch_nlp.main:app --host 0.0.0.0 --port 8080 | tee /var/log/uvicorn.log
