import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "node:http";
import multer from "multer";
import { eq, and } from "drizzle-orm";
import ExcelJS from "exceljs";
import { processOMRImage } from "./omr-processor";
import { db } from "./db";
import { users, answerKeys, scanResults } from "../shared/schema";
import {
  hashPassword, verifyPassword, signToken, verifyToken, encrypt, decrypt,
} from "./auth-utils";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const payload = verifyToken(auth.slice(7));
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  (req as any).userId = payload.userId;
  next();
}

function gradeLabel(pct: number): string {
  if (pct >= 95) return "A+";
  if (pct >= 85) return "A";
  if (pct >= 80) return "B+";
  if (pct >= 70) return "B";
  if (pct >= 65) return "C+";
  if (pct >= 55) return "C";
  if (pct >= 45) return "D";
  return "F";
}

export async function registerRoutes(app: Express): Promise<Server> {

  // ── Auth ──────────────────────────────────────────────────────────────

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username?.trim() || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }
    try {
      const existing = await db.query.users.findFirst({
        where: eq(users.username, username.trim()),
      });
      if (existing) {
        return res.status(409).json({ error: "Username already taken" });
      }
      const [user] = await db
        .insert(users)
        .values({ username: username.trim(), password: await hashPassword(password) })
        .returning();
      const token = signToken({ userId: user.id, username: user.username });
      res.json({ token, user: { userId: user.id, username: user.username } });
    } catch (e) {
      console.error("Register error:", e);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (!username?.trim() || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }
    try {
      const user = await db.query.users.findFirst({
        where: eq(users.username, username.trim()),
      });
      if (!user || !(await verifyPassword(password, user.password))) {
        return res.status(401).json({ error: "Invalid username or password" });
      }
      const token = signToken({ userId: user.id, username: user.username });
      res.json({ token, user: { userId: user.id, username: user.username } });
    } catch (e) {
      console.error("Login error:", e);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/auth/me", requireAuth, (req: Request, res: Response) => {
    res.json({ userId: (req as any).userId });
  });

  // ── Answer Keys ───────────────────────────────────────────────────────

  app.get("/api/keys", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const rows = await db.query.answerKeys.findMany({
      where: eq(answerKeys.userId, userId),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
    res.json(rows.map((r) => ({
      id: r.id,
      name: r.name,
      subject: r.subject,
      totalQuestions: r.totalQuestions,
      optionsPerQuestion: r.optionsPerQuestion,
      answers: JSON.parse(decrypt(r.answersEncrypted)),
      createdAt: r.createdAt.toISOString(),
    })));
  });

  app.post("/api/keys", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const { id, name, subject, totalQuestions, optionsPerQuestion, answers } = req.body;
    if (!id || !name || !answers) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const answersEncrypted = encrypt(JSON.stringify(answers));
    const existing = await db.query.answerKeys.findFirst({
      where: and(eq(answerKeys.id, id), eq(answerKeys.userId, userId)),
    });
    if (existing) {
      await db
        .update(answerKeys)
        .set({ name, subject, totalQuestions, optionsPerQuestion, answersEncrypted })
        .where(and(eq(answerKeys.id, id), eq(answerKeys.userId, userId)));
    } else {
      await db.insert(answerKeys).values({
        id, userId, name, subject, totalQuestions, optionsPerQuestion, answersEncrypted,
      });
    }
    res.json({ ok: true });
  });

  app.delete("/api/keys/:id", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    await db
      .delete(answerKeys)
      .where(and(eq(answerKeys.id, req.params.id), eq(answerKeys.userId, userId)));
    res.json({ ok: true });
  });

  // ── Scan Results ──────────────────────────────────────────────────────

  app.get("/api/results", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const rows = await db.query.scanResults.findMany({
      where: eq(scanResults.userId, userId),
      orderBy: (t, { desc }) => [desc(t.scannedAt)],
    });
    res.json(rows.map((r) => {
      const data = JSON.parse(decrypt(r.dataEncrypted));
      return {
        id: r.id,
        answerKeyId: r.answerKeyId,
        answerKeyName: r.answerKeyName,
        subject: r.subject,
        score: r.score,
        totalQuestions: r.totalQuestions,
        percentage: r.percentage,
        scannedAt: r.scannedAt.toISOString(),
        ...data,
      };
    }));
  });

  app.post("/api/results", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {
      id, answerKeyId, answerKeyName, subject, score, totalQuestions,
      percentage, detectedAnswers, correctAnswers, questionResults, imageUri,
    } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });

    const existing = await db.query.scanResults.findFirst({
      where: and(eq(scanResults.id, id), eq(scanResults.userId, userId)),
    });
    if (!existing) {
      const dataEncrypted = encrypt(
        JSON.stringify({ detectedAnswers, correctAnswers, questionResults, imageUri })
      );
      await db.insert(scanResults).values({
        id, userId, answerKeyId, answerKeyName, subject,
        dataEncrypted, score, totalQuestions, percentage,
      });
    }
    res.json({ ok: true });
  });

  app.delete("/api/results/:id", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    await db
      .delete(scanResults)
      .where(and(eq(scanResults.id, req.params.id), eq(scanResults.userId, userId)));
    res.json({ ok: true });
  });

  // ── Excel Export ──────────────────────────────────────────────────────

  app.get("/api/results/:id/export", async (req: Request, res: Response) => {
    // Accept token from Authorization header OR ?token= query param (for mobile link opens)
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string | undefined;
    const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : queryToken;
    if (!rawToken) return res.status(401).json({ error: "Unauthorized" });
    const payload = verifyToken(rawToken);
    if (!payload) return res.status(401).json({ error: "Invalid or expired token" });
    const userId = payload.userId;
    const row = await db.query.scanResults.findFirst({
      where: and(eq(scanResults.id, req.params.id), eq(scanResults.userId, userId)),
    });
    if (!row) return res.status(404).json({ error: "Result not found" });

    const data = JSON.parse(decrypt(row.dataEncrypted));
    const wb = new ExcelJS.Workbook();
    wb.creator = "BubbleScan";
    wb.created = new Date();

    const summary = wb.addWorksheet("Summary");
    summary.columns = [
      { header: "Field", key: "field", width: 22 },
      { header: "Value", key: "value", width: 32 },
    ];
    summary.getRow(1).font = { bold: true, size: 12 };
    summary.addRows([
      { field: "Exam Name", value: row.answerKeyName },
      { field: "Subject", value: row.subject },
      { field: "Score", value: `${row.score} / ${row.totalQuestions}` },
      { field: "Percentage", value: `${Math.round(row.percentage)}%` },
      { field: "Grade", value: gradeLabel(row.percentage) },
      { field: "Scanned At", value: new Date(row.scannedAt).toLocaleString() },
    ]);

    const details = wb.addWorksheet("Question Details");
    details.columns = [
      { header: "Q#", key: "q", width: 8 },
      { header: "Student Answer", key: "student", width: 18 },
      { header: "Correct Answer", key: "correct", width: 18 },
      { header: "Result", key: "result", width: 14 },
    ];
    details.getRow(1).font = { bold: true, size: 12 };
    for (const q of (data.questionResults || [])) {
      const r2 = details.addRow({
        q: q.questionNumber,
        student: q.selected || "-",
        correct: q.correct,
        result: q.isCorrect ? "Correct" : q.selected ? "Wrong" : "Blank",
      });
      r2.getCell("result").font = {
        color: {
          argb: q.isCorrect ? "FF10B981" : q.selected ? "FFF43F5E" : "FFFBBF24",
        },
      };
    }

    const safeName = row.answerKeyName.replace(/[^a-zA-Z0-9_-]/g, "_");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="bubblescan_${safeName}.xlsx"`
    );
    await wb.xlsx.write(res);
    res.end();
  });

  // ── OMR Scan ──────────────────────────────────────────────────────────

  app.post("/api/scan", requireAuth, upload.single("image"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const totalQuestions = parseInt(req.body.totalQuestions || "30");
      const optionsPerQuestion = parseInt(req.body.optionsPerQuestion || "4");
      const correctAnswers: string[] = JSON.parse(req.body.correctAnswers || "[]");
      const result = await processOMRImage(
        req.file.buffer, totalQuestions, optionsPerQuestion, correctAnswers
      );
      res.json(result);
    } catch (error: any) {
      console.error("OMR error:", error);
      res.status(500).json({ error: error.message || "Scan failed" });
    }
  });

  app.get("/api/health", (_req: Request, res: Response) => res.json({ status: "ok" }));

  return createServer(app);
}
