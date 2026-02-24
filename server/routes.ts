import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import multer from "multer";
import { processOMRImage } from "./omr-processor";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/scan", upload.single("image"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image provided" });
      }

      const totalQuestions = parseInt(req.body.totalQuestions || "30");
      const optionsPerQuestion = parseInt(req.body.optionsPerQuestion || "4");
      const correctAnswers: string[] = JSON.parse(req.body.correctAnswers || "[]");

      const result = await processOMRImage(
        req.file.buffer,
        totalQuestions,
        optionsPerQuestion,
        correctAnswers
      );

      res.json(result);
    } catch (error: any) {
      console.error("OMR processing error:", error);
      res.status(500).json({ error: error.message || "Failed to process image" });
    }
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  const httpServer = createServer(app);
  return httpServer;
}
