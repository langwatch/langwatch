# ACME Outdoor Gear support agent

A small FastAPI chat agent for order status and returns. The model call is a
canned-response function, so it runs with no provider account.

## Run

```bash
pip install -r requirements.txt
uvicorn main:app --port 8000
```

## Use

POST `/login` with `{"email": "demo@example.com", "password": "demo-password"}`
to get a session cookie, then POST `/chat` with
`{"messages": [{"role": "user", "content": "Where is order A-1001?"}]}`.
The reply comes back as `{"reply": "..."}`.
