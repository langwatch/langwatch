import type { Request, Response, NextFunction } from "express";

export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const username = process.env.SKYNET_USERNAME;
  const password = process.env.SKYNET_PASSWORD;

  if (!username || !password) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Skynet"');
    res.status(401).send("Authentication required");
    return;
  }

  const credentials = Buffer.from(authHeader.slice(6), "base64").toString();
  // Split on first ":" only — passwords may contain colons
  const colonIdx = credentials.indexOf(":");
  if (colonIdx === -1) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Skynet"');
    res.status(401).send("Invalid credentials");
    return;
  }
  const user = credentials.slice(0, colonIdx);
  const pass = credentials.slice(colonIdx + 1);

  if (user === username && pass === password) {
    next();
  } else {
    res.setHeader("WWW-Authenticate", 'Basic realm="Skynet"');
    res.status(401).send("Invalid credentials");
  }
}
