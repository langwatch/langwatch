import { Router } from "express";

const router = Router();

router.get("/health", (_req, res) => {
  res.send("OK");
});

export default router;
