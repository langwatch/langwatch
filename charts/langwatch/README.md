## Installation

When installing this chart, the following values must be provided:

- `app.env.NEXTAUTH_SECRET`: A random string used to hash tokens, sign cookies and generate cryptographic keys. If not provided, authentication will fail.
- `app.env.API_TOKEN_JWT_SECRET`: A random string to store provided API tokens.
- `app.env.BASE_HOST`: The base URL of the application.
- `app.env.NEXTAUTH_URL`: The URL of the authentication service.

Example:

```bash
export NEXTAUTH_SECRET=$(openssl rand -base64 32)
export API_TOKEN_JWT_SECRET=$(openssl rand -base64 32)
export BASE_HOST="http://localhost:5560" # or yourdomain.com
export NEXTAUTH_URL="http://localhost:5560" # or yourdomain.com

helm install langwatch ./langwatch --set app.env.NEXTAUTH_SECRET=$NEXTAUTH_SECRET --set app.env.API_TOKEN_JWT_SECRET=$API_TOKEN_JWT_SECRET --set app.env.BASE_HOST=$BASE_HOST --set app.env.NEXTAUTH_URL=$NEXTAUTH_URL
```
