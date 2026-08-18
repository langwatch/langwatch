# ACME Outdoor Gear support agent

A small FastAPI chat agent for order status and returns. The model call is a
canned-response function, so it runs with no provider account.

## Run

```bash
pip install -r requirements.txt
INSECURE_DEV_COOKIES=1 uvicorn main:app --port 8000
```

The session cookie is Secure by default, for HTTPS deployments.
`INSECURE_DEV_COOKIES=1` turns that off so the cookie also works over
plain HTTP on localhost.

## Use

POST `/login` with `{"email": "demo@example.com", "password": "demo-password"}`
to get a session cookie, then POST `/chat` with
`{"messages": [{"role": "user", "content": "Where is order A-1001?"}]}`.
The reply comes back as `{"reply": "..."}`.
