FROM python:3.11-slim

WORKDIR /usr/src/app

RUN pip install poetry

COPY poetry.toml poetry.lock pyproject.toml .
RUN poetry install

COPY . .

EXPOSE 8080

CMD poetry run hypercorn langwatch_nlp.main:app --bind :8080
