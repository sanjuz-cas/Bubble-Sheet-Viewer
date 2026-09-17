import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "node:http";
import multer from "multer";
import { eq, and } from "drizzle-orm";
import ExcelJS from "exceljs";
import { processOMRImage, unpackPDFBuffer } from "./omr-processor";
import { db } from "./db";
import { users, answerKeys, scanResults } from "../shared/schema";
import {
  hashPassword, verifyPassword, signToken, verifyToken, encrypt, decrypt,
} from "./auth-utils";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB for large 200+ page OMR PDF documents
});

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const payload = verifyToken(auth.slice(7));
    if (payload) {
      (req as any).userId = payload.userId;
      return next();
    }
  }
  (req as any).userId = "teacher_guest_default";
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

function formatMark(value: number): string {
  const num = Number(value);
  if (isNaN(num)) return "0";
  if (Number.isInteger(num)) return num.toString();
  return parseFloat(num.toFixed(3)).toString();
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

  app.post("/api/auth/verify", requireAuth, async (req: Request, res: Response) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password required" });
    const userId = (req as any).userId;
    try {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!user || !(await verifyPassword(password, user.password))) {
        return res.status(401).json({ error: "Incorrect password" });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Verification failed" });
    }
  });

  // ── Answer Keys ───────────────────────────────────────────────────────

  app.get("/api/keys", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const rows = await db.query.answerKeys.findMany({
      where: eq(answerKeys.userId, userId),
      orderBy: (t: any, { desc }: any) => [desc(t.createdAt)],
    });
    const validRows = [];
    for (const r of rows) {
      try {
        let rawStr = "";
        try {
          rawStr = decrypt(r.answersEncrypted);
        } catch {
          rawStr = r.answersEncrypted;
        }
        const stored = JSON.parse(rawStr);
        const isLegacyAnswers = Array.isArray(stored);
        const normalizeAnswers = (values: unknown): string[][] =>
          Array.isArray(values)
            ? values.map((value) => Array.isArray(value) ? value.filter(Boolean) : value ? [String(value)] : [])
            : [];
        validRows.push({
          id: r.id,
          name: r.name,
          subject: r.subject,
          totalQuestions: r.totalQuestions,
          optionsPerQuestion: r.optionsPerQuestion,
          marksPerQuestion: Number(stored.marksPerQuestion) > 0 ? Number(stored.marksPerQuestion) : 1,
          answers: normalizeAnswers(isLegacyAnswers ? stored : (stored.answers || [])),
          ...(isLegacyAnswers || !stored.setAnswers
            ? {}
            : { setAnswers: Object.fromEntries(
                Object.entries(stored.setAnswers).map(([setName, values]) => [
                  setName,
                  normalizeAnswers(values),
                ])
              ) }),
          createdAt: typeof r.createdAt === 'string' ? r.createdAt : r.createdAt.toISOString(),
        });
      } catch (e) {
        console.warn(`Skipping key ${r.id} due to parse error:`, e);
      }
    }
    res.json(validRows);
  });

  app.post("/api/keys", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {
      id, name, subject, totalQuestions, optionsPerQuestion, marksPerQuestion, answers, setAnswers,
    } = req.body;
    if (!id || !name || !answers) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const answersEncrypted = encrypt(JSON.stringify({
      answers,
      setAnswers,
      marksPerQuestion: Number(marksPerQuestion) > 0 ? Number(marksPerQuestion) : 1,
    }));
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
      .where(and(eq(answerKeys.id, String(req.params.id)), eq(answerKeys.userId, userId)));
    res.json({ ok: true });
  });

  // ── Scan Results ──────────────────────────────────────────────────────

  function parseResultData(r: any) {
    let rawStr = "";
    try {
      rawStr = decrypt(r.dataEncrypted);
    } catch {
      rawStr = r.dataEncrypted;
    }
    let data: any = {};
    try {
      data = JSON.parse(rawStr);
    } catch {}
    return {
      id: r.id,
      answerKeyId: r.answerKeyId,
      answerKeyName: r.answerKeyName,
      subject: r.subject,
      score: r.score,
      totalQuestions: r.totalQuestions,
      totalMarks: Number(data.totalMarks) > 0 ? Number(data.totalMarks) : r.totalQuestions,
      percentage: r.percentage,
      scannedAt: typeof r.scannedAt === 'string' ? r.scannedAt : (r.scannedAt?.toISOString ? r.scannedAt.toISOString() : new Date().toISOString()),
      detectedRollNumber: data.detectedRollNumber || "",
      detectedSet: data.detectedSet || "",
      detectedAnswers: data.detectedAnswers || [],
      correctAnswers: data.correctAnswers || [],
      questionResults: data.questionResults || [],
      imageUri: data.imageUri,
      annotatedImage: data.annotatedImage || undefined,
    };
  }

  app.get("/api/results", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const rows = await db.query.scanResults.findMany({
      where: eq(scanResults.userId, userId),
      orderBy: (t: any, { desc }: any) => [desc(t.scannedAt)],
    });
    const validRows = rows.map(parseResultData);
    res.json(validRows);
  });

  app.post("/api/results", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const {
      id, answerKeyId, answerKeyName, subject, score, totalQuestions,
      percentage, totalMarks, detectedAnswers, correctAnswers, questionResults, imageUri,
      detectedSet, detectedRollNumber, annotatedImage,
    } = req.body;
    if (!id) return res.status(400).json({ error: "Missing id" });

    const existing = await db.query.scanResults.findFirst({
      where: and(eq(scanResults.id, id), eq(scanResults.userId, userId)),
    });
    if (!existing) {
      const dataEncrypted = encrypt(
        JSON.stringify({
          detectedAnswers,
          correctAnswers,
          questionResults,
          totalMarks,
          imageUri,
          detectedSet,
          detectedRollNumber,
          annotatedImage,
        })
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
      .where(and(eq(scanResults.id, String(req.params.id)), eq(scanResults.userId, userId)));
    res.json({ ok: true });
  });

  // ── Dual CSV Export (Teacher Master Ledger & Student Scorecard) ───────

  app.get("/api/results/export/csv", async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string | undefined;
    const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : queryToken;
    let userId = "teacher_guest_default";
    if (rawToken) {
      const payload = verifyToken(rawToken);
      if (payload) userId = payload.userId;
    }

    const answerKeyId = req.query.answerKeyId as string | undefined;
    const idsParam = req.query.ids as string | undefined;
    const exportType = (req.query.type as string || "teacher").toLowerCase();

    const rows = await db.query.scanResults.findMany({
      where: eq(scanResults.userId, userId),
    });
    let parsed = rows.map(parseResultData);

    if (answerKeyId) {
      parsed = parsed.filter((r: any) => r.answerKeyId === answerKeyId);
    }
    if (idsParam) {
      const idSet = new Set(idsParam.split(","));
      parsed = parsed.filter((r: any) => idSet.has(r.id));
    }

    // Sort by Roll Number ascending
    parsed.sort((a: any, b: any) => {
      const rollA = (a.detectedRollNumber || "").trim();
      const rollB = (b.detectedRollNumber || "").trim();
      if (!rollA && !rollB) return 0;
      if (!rollA) return 1;
      if (!rollB) return -1;
      const numA = parseInt(rollA, 10);
      const numB = parseInt(rollB, 10);
      if (!isNaN(numA) && !isNaN(numB) && String(numA) === rollA && String(numB) === rollB) {
        return numA - numB;
      }
      return rollA.localeCompare(rollB, undefined, { numeric: true, sensitivity: "base" });
    });

    const escapeCSV = (str: any) => {
      const val = String(str ?? "");
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };

    const maxQ = Math.max(0, ...parsed.map((r: any) => r.totalQuestions || r.questionResults?.length || 0));
    const csvLines: string[] = [];

    // Calculate ranks based on total marks score
    const ranked = [...parsed].sort((a: any, b: any) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const rankMap = new Map<string, number>();
    ranked.forEach((r: any, idx: number) => rankMap.set(r.id, idx + 1));

    // Sort all rows strictly roll-number-wise in natural numerical ascending order (blank/N/A at bottom)
    parsed.sort((a: any, b: any) => {
      const rollA = String(a.detectedRollNumber || "").trim();
      const rollB = String(b.detectedRollNumber || "").trim();
      if (!rollA && !rollB) return 0;
      if (!rollA || rollA === "N/A" || rollA === "undefined") return 1;
      if (!rollB || rollB === "N/A" || rollB === "undefined") return -1;
      return rollA.localeCompare(rollB, undefined, { numeric: true, sensitivity: "base" });
    });

    if (exportType === "student") {
      // ── STUDENT REFERENCE CSV ──
      csvLines.push(`"=== STUDENT SCORECARD & PERFORMANCE ROSTER ==="`);
      csvLines.push(`"Exam: ${escapeCSV(parsed[0]?.answerKeyName || 'Examination')}"`);
      csvLines.push(`"Subject: ${escapeCSV(parsed[0]?.subject || 'Assessment')}"`);
      csvLines.push(`"Total Students: ${parsed.length}"`);
      csvLines.push(`"Published Date: ${new Date().toLocaleDateString()}"`);
      csvLines.push("");

      const headers = [
        "Rank",
        "Roll Number",
        "Set",
        "Exam Name",
        "Subject",
        "Marks Obtained",
        "Total Marks",
        "Percentage",
        "Grade",
        "Remarks",
      ];
      for (let q = 1; q <= maxQ; q++) {
        headers.push(`Q${q} Marked`, `Q${q} Score`, `Q${q} Status`);
      }
      headers.push("Evaluation Date");
      csvLines.push(headers.map(escapeCSV).join(","));

      parsed.forEach((item: any) => {
        const grade = gradeLabel(item.percentage);
        const rank = rankMap.get(item.id) || 1;
        const dateStr = new Date(item.scannedAt).toLocaleDateString();

        let remark = "Needs Improvement";
        if (item.percentage >= 90) remark = "Outstanding Performance";
        else if (item.percentage >= 75) remark = "Excellent";
        else if (item.percentage >= 60) remark = "Good";
        else if (item.percentage >= 45) remark = "Satisfactory";

        const row = [
          `#${rank}`,
          item.detectedRollNumber || "N/A",
          item.detectedSet || "N/A",
          item.answerKeyName,
          item.subject,
          formatMark(item.score),
          formatMark(item.totalMarks || item.totalQuestions),
          `${Math.round(item.percentage)}%`,
          grade,
          remark,
        ];

        const qMap = new Map((item.questionResults || []).map((qr: any) => [qr.questionNumber, qr]));
        for (let q = 1; q <= maxQ; q++) {
          const qr: any = qMap.get(q);
          if (qr) {
            const marked = Array.isArray(qr.selected) ? qr.selected.join("+") : qr.selected || "";
            const isBlank = !marked;
            const isPartial = !qr.isCorrect && Number(qr.mark) > 0;
            const qStatus = qr.isCorrect ? "✓ Correct" : isPartial ? "≈ Partial" : isBlank ? "— Blank" : "✗ Incorrect";
            row.push(marked || "—", formatMark(qr.mark), qStatus);
          } else {
            row.push("—", "0", "— Blank");
          }
        }
        row.push(dateStr);
        csvLines.push(row.map(escapeCSV).join(","));
      });

      const csvContent = "\uFEFF" + csvLines.join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="student_scorecards.csv"');
      return res.send(csvContent);
    }

    // ── TEACHER REFERENCE MASTER CSV (Default) ──
    const scores = parsed.map((r: any) => Number(r.score) || 0);
    const pcts = parsed.map((r: any) => Number(r.percentage) || 0);
    const totalStudents = parsed.length;
    const avgScore = totalStudents ? scores.reduce((a: number, b: number) => a + b, 0) / totalStudents : 0;
    const avgPct = totalStudents ? pcts.reduce((a: number, b: number) => a + b, 0) / totalStudents : 0;
    const maxScore = totalStudents ? Math.max(...scores) : 0;
    const minScore = totalStudents ? Math.min(...scores) : 0;
    const passCount = pcts.filter((p: number) => p >= 45).length;
    const passRate = totalStudents ? (passCount / totalStudents) * 100 : 0;

    csvLines.push(`"=== BUBBLESCAN TEACHER MASTER ASSESSMENT LEDGER ==="`);
    csvLines.push(`"Exam Name: ${escapeCSV(parsed[0]?.answerKeyName || 'OMR Exam')}"`);
    csvLines.push(`"Subject: ${escapeCSV(parsed[0]?.subject || 'Assessment')}"`);
    csvLines.push(`"Total Candidates Evaluated: ${totalStudents}"`);
    csvLines.push(`"Class Average Score: ${avgScore.toFixed(2)} (${avgPct.toFixed(1)}%)"`);
    csvLines.push(`"Highest Score: ${maxScore.toFixed(2)} | Lowest Score: ${minScore.toFixed(2)}"`);
    csvLines.push(`"Pass Rate (>=45%): ${passRate.toFixed(1)}% (${passCount}/${totalStudents} Passed)"`);
    csvLines.push(`"Report Generated At: ${new Date().toLocaleString()}"`);
    csvLines.push("");

    const teacherHeaders = [
      "S.No.",
      "Rank",
      "Roll Number",
      "Set",
      "Exam Name",
      "Subject",
      "Marks Obtained",
      "Max Marks",
      "Percentage (%)",
      "Grade",
      "Result Status",
      "Correct Count",
      "Partial Count",
      "Wrong Count",
      "Blank Count",
    ];
    for (let q = 1; q <= maxQ; q++) {
      teacherHeaders.push(`Q${q} Marked`, `Q${q} Key`, `Q${q} Marks`, `Q${q} Status`);
    }
    teacherHeaders.push("Evaluation Timestamp");
    csvLines.push(teacherHeaders.map(escapeCSV).join(","));

    parsed.forEach((item: any, idx: number) => {
      const grade = gradeLabel(item.percentage);
      const rank = rankMap.get(item.id) || idx + 1;
      const status = item.percentage >= 45 ? "PASSED" : "NEEDS ATTENTION";
      const qResults = item.questionResults || [];
      const corrCnt = qResults.filter((q: any) => q.isCorrect).length;
      const partCnt = qResults.filter((q: any) => !q.isCorrect && Number(q.mark) > 0).length;
      const wrongCnt = qResults.filter((q: any) => !q.isCorrect && Number(q.mark) === 0 && (q.selected && q.selected.length > 0)).length;
      const blankCnt = qResults.filter((q: any) => !q.selected || q.selected.length === 0).length;

      const row = [
        idx + 1,
        `#${rank}`,
        item.detectedRollNumber || "N/A",
        item.detectedSet || "N/A",
        item.answerKeyName,
        item.subject,
        formatMark(item.score),
        formatMark(item.totalMarks || item.totalQuestions),
        `${Math.round(item.percentage)}%`,
        grade,
        status,
        corrCnt,
        partCnt,
        wrongCnt,
        blankCnt,
      ];

      const qMap = new Map(qResults.map((qr: any) => [qr.questionNumber, qr]));
      for (let q = 1; q <= maxQ; q++) {
        const qr: any = qMap.get(q);
        if (qr) {
          const marked = Array.isArray(qr.selected) ? qr.selected.join("+") : qr.selected || "";
          const correct = Array.isArray(qr.correct) ? qr.correct.join("+") : qr.correct || "";
          const isBlank = !marked;
          const isPartial = !qr.isCorrect && Number(qr.mark) > 0;
          const qStatus = qr.isCorrect ? "Correct" : isPartial ? "Partial" : isBlank ? "Blank" : "Wrong";
          row.push(marked || "—", correct || "—", formatMark(qr.mark), qStatus);
        } else {
          row.push("—", "—", "0", "Blank");
        }
      }
      row.push(new Date(item.scannedAt).toLocaleString());
      csvLines.push(row.map(escapeCSV).join(","));
    });

    const csvContent = "\uFEFF" + csvLines.join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="teacher_omr_master_ledger.csv"');
    res.send(csvContent);
  });

  // ── Multi-Page Institutional & 1-Page-per-OMR PDF Export ─────────────

  app.get("/api/results/export/pdf", async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string | undefined;
    const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : queryToken;
    let userId = "teacher_guest_default";
    if (rawToken) {
      const payload = verifyToken(rawToken);
      if (payload) userId = payload.userId;
    }

    const answerKeyId = req.query.answerKeyId as string | undefined;
    const idsParam = req.query.ids as string | undefined;

    const rows = await db.query.scanResults.findMany({
      where: eq(scanResults.userId, userId),
    });
    let parsed = rows.map(parseResultData);

    if (answerKeyId) {
      parsed = parsed.filter((r: any) => r.answerKeyId === answerKeyId);
    }
    if (idsParam) {
      const idSet = new Set(idsParam.split(","));
      parsed = parsed.filter((r: any) => idSet.has(r.id));
    }

    if (parsed.length === 0) {
      return res.status(404).json({ error: "No scan results found for PDF export" });
    }

    // Sort parsed rows strictly roll-number-wise in natural numerical ascending order (blank/N/A at bottom)
    parsed.sort((a: any, b: any) => {
      const rollA = String(a.detectedRollNumber || "").trim();
      const rollB = String(b.detectedRollNumber || "").trim();
      if (!rollA && !rollB) return 0;
      if (!rollA || rollA === "N/A" || rollA === "undefined") return 1;
      if (!rollB || rollB === "N/A" || rollB === "undefined") return -1;
      return rollA.localeCompare(rollB, undefined, { numeric: true, sensitivity: "base" });
    });

    const { spawn } = await import("node:child_process");
    const { writeFile, readFile, unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const tmpIn = join(tmpdir(), `dossier_in_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    const tmpOut = join(tmpdir(), `dossier_out_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);

    const payloadData = {
      examName: parsed[0]?.answerKeyName || "Assessment Examination",
      subject: parsed[0]?.subject || "General Subject",
      totalMarks: parsed[0]?.totalMarks || 30.0,
      results: parsed.map((r: any) => ({
        ...r,
        grade: gradeLabel(r.percentage),
      })),
    };

    try {
      await writeFile(tmpIn, JSON.stringify(payloadData));
      const scriptPath = join(process.cwd(), "server", "omr_pdf_generator.py");

      await new Promise<void>((resolve, reject) => {
        const py = spawn(process.platform === "win32" ? "python" : "python3", [
          scriptPath,
          tmpIn,
          tmpOut,
        ]);
        let stderr = "";
        py.stderr.on("data", (c) => { stderr += c.toString(); });
        py.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`PDF Generator exited with code ${code}: ${stderr}`));
        });
        py.on("error", reject);
      });

      const pdfBuffer = await readFile(tmpOut);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="omr_master_dossier.pdf"');
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("PDF Export error:", err);
      res.status(500).json({ error: err.message || "PDF generation failed" });
    } finally {
      unlink(tmpIn).catch(() => {});
      unlink(tmpOut).catch(() => {});
    }
  });

  // ── Single Student PDF Certificate / Scorecard Export ─────────────────

  app.get("/api/results/:id/export/pdf", async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string | undefined;
    const rawToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : queryToken;
    let userId = "teacher_guest_default";
    if (rawToken) {
      const payload = verifyToken(rawToken);
      if (payload) userId = payload.userId;
    }

    const row = await db.query.scanResults.findFirst({
      where: and(eq(scanResults.id, String(req.params.id)), eq(scanResults.userId, userId)),
    });
    if (!row) return res.status(404).json({ error: "Result not found" });

    const student: any = parseResultData(row);
    student.grade = gradeLabel(student.percentage);

    const { spawn } = await import("node:child_process");
    const { writeFile, readFile, unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const tmpIn = join(tmpdir(), `student_in_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    const tmpOut = join(tmpdir(), `student_out_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);

    const payloadData = {
      examName: student.answerKeyName,
      subject: student.subject,
      totalMarks: student.totalMarks,
      results: [student],
    };

    try {
      await writeFile(tmpIn, JSON.stringify(payloadData));
      const scriptPath = join(process.cwd(), "server", "omr_pdf_generator.py");

      await new Promise<void>((resolve, reject) => {
        const py = spawn(process.platform === "win32" ? "python" : "python3", [
          scriptPath,
          tmpIn,
          tmpOut,
        ]);
        let stderr = "";
        py.stderr.on("data", (c) => { stderr += c.toString(); });
        py.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`PDF Generator exited with code ${code}: ${stderr}`));
        });
        py.on("error", reject);
      });

      const pdfBuffer = await readFile(tmpOut);
      const safeRoll = (student.detectedRollNumber || "student").replace(/[^a-zA-Z0-9_-]/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="student_report_${safeRoll}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("Student PDF Export error:", err);
      res.status(500).json({ error: err.message || "Student PDF generation failed" });
    } finally {
      unlink(tmpIn).catch(() => {});
      unlink(tmpOut).catch(() => {});
    }
  });

  // ── Excel Export (Single & Multi-Result) ──────────────────────────────

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
      where: and(eq(scanResults.id, String(req.params.id)), eq(scanResults.userId, userId)),
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
      { field: "Roll Number", value: data.detectedRollNumber || "Not detected" },
      { field: "Set", value: data.detectedSet || "Not detected" },
      { field: "Score", value: `${formatMark(row.score)} / ${formatMark(data.totalMarks || row.totalQuestions)}` },
      { field: "Percentage", value: `${Math.round(row.percentage)}%` },
      { field: "Grade", value: gradeLabel(row.percentage) },
      { field: "Scanned At", value: new Date(row.scannedAt).toLocaleString() },
    ]);

    const details = wb.addWorksheet("Question Details");
    details.columns = [
      { header: "Question",        key: "q",       width: 12 },
      { header: "Student Marked",  key: "student", width: 18 },
      { header: "Correct Answer",  key: "correct", width: 18 },
      { header: "Mark",            key: "mark",    width: 10 },
      { header: "Status",          key: "status",  width: 12 },
      { header: "Notes",           key: "notes",   width: 36 },
    ];
    const hdr = details.getRow(1);
    hdr.font = { bold: true, size: 12 };
    hdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E1B2E" } };
    hdr.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };

    for (const q of (data.questionResults || [])) {
      const selectedText = Array.isArray(q.selected) ? q.selected.join(" + ") : q.selected;
      const isBlank = !selectedText;
      const isPartial = !q.isCorrect && (Number(q.mark) > 0);
      const statusText = q.isCorrect
        ? "✓ Correct"
        : isPartial
          ? "≈ Partial"
          : isBlank
            ? "— Blank"
            : "✗ Wrong";
      const correctText = Array.isArray(q.correct) ? q.correct.join(" or ") : q.correct;
      const notes = q.isCorrect
        ? `Full credit: marked ${correctText}`
        : isPartial
          ? `Partial credit: marked ${selectedText} (correct: ${correctText})`
          : isBlank
            ? `No answer (correct: ${correctText})`
            : `Wrong: marked ${selectedText} (correct: ${correctText})`;

      const r2 = details.addRow({
        q:       `Q${q.questionNumber}`,
        student: selectedText || "No answer",
        correct: correctText,
        mark:    formatMark(Number(q.mark) || 0),
        status:  statusText,
        notes,
      });

      const statusArgb = q.isCorrect
        ? "FF10B981"
        : isPartial
          ? "FF00B4D8"
          : isBlank
            ? "FFFBBF24"
            : "FFF43F5E";
      r2.getCell("status").font  = { color: { argb: statusArgb }, bold: true };
      r2.getCell("student").font = { bold: !q.isCorrect && !isBlank };
      r2.getCell("student").font = {
        color: { argb: statusArgb },
        bold: true,
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

  app.post("/api/omr/process", async (req: Request, res: Response) => {
    try {
      const { image, numQuestions = 10, optionsPerQuestion = 6, correctAnswers = [] } = req.body;
      if (!image) {
        return res.status(400).json({ error: "No image payload provided" });
      }

      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const imageBuffer = Buffer.from(base64Data, "base64");

      const result = await processOMRImage(
        imageBuffer,
        parseInt(String(numQuestions), 10),
        parseInt(String(optionsPerQuestion), 10),
        correctAnswers
      );

      res.json(result);
    } catch (error: any) {
      console.error("OMR process error:", error);
      res.status(500).json({ error: error.message || "Failed to process OMR image" });
    }
  });

  app.post("/api/scan", requireAuth, upload.single("image"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const totalQuestions = parseInt(req.body.totalQuestions || "30");
      const optionsPerQuestion = parseInt(req.body.optionsPerQuestion || "4");
      const correctAnswers: string[][] = JSON.parse(req.body.correctAnswers || "[]");
      const result = await processOMRImage(
        req.file.buffer, totalQuestions, optionsPerQuestion, correctAnswers
      );
      res.json(result);
    } catch (error: any) {
      console.error("OMR error:", error);
      res.status(500).json({ error: error.message || "Scan failed" });
    }
  });

  app.get("/api/omr/sample-test-images", async (req: Request, res: Response) => {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      // First try the project's omr_sheets directory, then fallback to test images folder
      const projectSheetsDir = path.resolve(process.cwd(), "omr_sheets");
      const testDownloadsDir = path.resolve(process.env.USERPROFILE || "C:\\Users\\brr33", "Downloads", "test images");
      const limitParam = parseInt(String(req.query.limit || "12"), 10);
      
      let testDir = projectSheetsDir;
      if (!fs.existsSync(projectSheetsDir)) {
        testDir = testDownloadsDir;
      }
      if (!fs.existsSync(testDir)) {
        return res.json({ images: [], total: 0 });
      }

      const allFiles = fs.readdirSync(testDir).filter((f: string) => /\.(png|jpg|jpeg)$/i.test(f)).sort();
      const files = allFiles.slice(0, limitParam);
      const images = files.map((filename: string) => {
        const filePath = path.join(testDir, filename);
        const buffer = fs.readFileSync(filePath);
        const ext = path.extname(filename).toLowerCase().replace(".", "");
        const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
        const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
        return {
          filename,
          size: buffer.length,
          dataUrl
        };
      });

      res.json({ images, total: allFiles.length, loaded: files.length });
    } catch (e: any) {
      console.error("Error loading sample test images:", e);
      res.status(500).json({ error: "Failed to load sample images" });
    }
  });

  // ── PDF Multi-Page Unpacker & Bulk Ingestion ────────────────────────────

  app.post("/api/omr/unpack-pdf", upload.single("pdf"), async (req: Request, res: Response) => {
    try {
      let pdfBuffer: Buffer | null = null;
      if (req.file) {
        pdfBuffer = req.file.buffer;
      } else if (req.body?.pdf) {
        const raw = req.body.pdf.replace(/^data:application\/pdf;base64,/, "");
        pdfBuffer = Buffer.from(raw, "base64");
      } else if (req.body?.pdfBase64) {
        pdfBuffer = Buffer.from(req.body.pdfBase64, "base64");
      }

      if (!pdfBuffer || pdfBuffer.length === 0) {
        return res.status(400).json({ error: "No PDF payload provided" });
      }

      const dpi = parseInt(String(req.body?.dpi || req.query?.dpi || "180"), 10);
      const result = await unpackPDFBuffer(pdfBuffer, isNaN(dpi) ? 180 : dpi);

      res.json(result);
    } catch (err: any) {
      console.error("PDF Unpacker error:", err);
      res.status(500).json({ error: err.message || "Failed to unpack PDF" });
    }
  });

  app.get("/api/omr/generate-sample-pdf", async (req: Request, res: Response) => {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const projectSheetsDir = path.resolve(process.cwd(), "omr_sheets");
      const testDownloadsDir = path.resolve(process.env.USERPROFILE || "C:\\Users\\brr33", "Downloads", "test images");
      let testDir = projectSheetsDir;
      if (!fs.existsSync(projectSheetsDir)) testDir = testDownloadsDir;
      if (!fs.existsSync(testDir)) return res.status(404).json({ error: "No sample OMR sheets found" });

      const allFiles = fs.readdirSync(testDir).filter((f: string) => /\.(png|jpg|jpeg)$/i.test(f)).sort();
      if (allFiles.length === 0) return res.status(404).json({ error: "No images in directory" });

      const count = Math.min(200, Math.max(1, parseInt(String(req.query.count || "20"), 10)));
      const format = String(req.query.format || "unpack"); // 'unpack' or 'download'

      // Build multi-page PDF using Python PyMuPDF
      const imgPaths: string[] = [];
      for (let i = 0; i < count; i++) {
        const f = allFiles[i % allFiles.length];
        imgPaths.push(path.join(testDir, f));
      }

      const script = `
import sys, json, fitz
doc = fitz.open()
img_paths = json.loads(sys.argv[1])
for p in img_paths:
    img = fitz.open(p)
    rect = img[0].rect
    pdfbytes = img.convert_to_pdf()
    img.close()
    imgPDF = fitz.open("pdf", pdfbytes)
    page = doc.new_page(width=rect.width, height=rect.height)
    page.show_pdf_page(rect, imgPDF, 0)
    imgPDF.close()
pdf_data = doc.tobytes()
doc.close()
sys.stdout.buffer.write(pdf_data)
`;

      const { spawn } = await import("node:child_process");
      const py = spawn(process.platform === "win32" ? "python" : "python3", ["-c", script, JSON.stringify(imgPaths)]);

      const chunks: Buffer[] = [];
      py.stdout.on("data", (d) => chunks.push(d));
      let errStr = "";
      py.stderr.on("data", (d) => errStr += d.toString());

      await new Promise<void>((resolve, reject) => {
        py.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(errStr || "PDF creation failed"));
        });
        py.on("error", reject);
      });

      const pdfBuf = Buffer.concat(chunks);

      if (format === "download") {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="sample_omr_batch_${count}_pages.pdf"`);
        return res.send(pdfBuf);
      }

      // If format is unpack, unpack right away and return the page images
      const unpacked = await unpackPDFBuffer(pdfBuf, 180);
      res.json({
        ...unpacked,
        source: `Generated Sample Multi-Page PDF (${count} OMR Sheets)`
      });
    } catch (e: any) {
      console.error("Error generating sample PDF:", e);
      res.status(500).json({ error: e.message || "Failed to generate sample PDF" });
    }
  });

  app.get("/api/health", (_req: Request, res: Response) => res.json({ status: "ok" }));

  return createServer(app);
}
