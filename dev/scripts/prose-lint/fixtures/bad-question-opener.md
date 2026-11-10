Ever wondered why your support bot answers with confidence when retrieval came back empty?

We traced 212 such answers last month to a `try/except` that returned an empty list on a Postgres timeout.
